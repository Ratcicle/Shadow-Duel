import Player from "./Player.js";
import { cardDatabase } from "../data/cards.js";
import Card from "./Card.js";

export default class Bot extends Player {
  constructor() {
    super("bot", "Opponent");
    this.maxSimulationsPerPhase = 20;
    this.maxChainedActions = 2;
  }

  // Sobrescreve buildDeck para usar deck Luminarch
  buildDeck(deckList = null) {
    this.deck = [];
    const copies = {};

    const addCard = (data) => {
      copies[data.id] = copies[data.id] || 0;
      if (copies[data.id] >= 3 || this.deck.length >= this.maxDeckSize)
        return false;
      this.deck.push(new Card(data, this.id));
      copies[data.id]++;
      return true;
    };

    // Deck Luminarch fixo e balanceado
    const luminarchDeck = [
      // Monstros principais (nível baixo - searchers/utility)
      47,
      47,
      47, // Luminarch Valiant – Knight of the Dawn (searcher)
      49,
      49,
      49, // Luminarch Aegisbearer (taunt/tank)
      56,
      56, // Luminarch Sanctified Arbiter (busca Convocation)
      52,
      52, // Luminarch Magic Sickle (baixo nível)
      63,
      63, // Luminarch Enchanted Halberd
      // Monstros médios/altos (bosses)
      50,
      50, // Luminarch Moonblade Captain (revive + double attack)
      51,
      51, // Luminarch Celestial Marshal (boss lv7)
      54, // Luminarch Radiant Lancer (boss lv8)
      55, // Luminarch Aurora Seraph (boss lv8)
      53, // Luminarch Sanctum Protector (lv7 defesa)
      // Magias
      57,
      57, // Luminarch Knights Convocation
      58,
      58, // Sanctum of the Luminarch Citadel (field spell)
      64,
      64, // Luminarch Moonlit Blessing (recovery)
      48,
      48, // Luminarch Holy Shield (proteção)
      61, // Luminarch Crescent Shield (equip)
      65, // Luminarch Sacred Judgment (comeback)
    ];

    for (const cardId of luminarchDeck) {
      const data = cardDatabase.find((c) => c.id === cardId);
      if (data) {
        addCard(data);
      }
    }

    this.shuffleDeck();
  }

  async makeMove(game) {
    await new Promise((resolve) => setTimeout(resolve, 800));

    if (game.phase === "main1" || game.phase === "main2") {
      this.mainPhaseLogic(game);
    } else if (game.phase === "battle") {
      this.battlePhaseLogic(game);
    } else if (game.phase === "end") {
      game.endTurn();
    }
  }

  mainPhaseLogic(game) {
    let actionsTaken = 0;
    let iterations = 0;
    let improved = true;

    while (
      iterations < this.maxChainedActions &&
      actionsTaken < this.maxSimulationsPerPhase &&
      improved
    ) {
      iterations += 1;
      const baseScore = this.evaluateBoard(game, this);
      const candidates = this.generateMainPhaseActions(game);

      if (candidates.length === 0) break;

      let best = null;
      let bestDelta = -Infinity;

      for (const action of candidates.slice(0, this.maxSimulationsPerPhase)) {
        const simState = this.cloneGameState(game);
        const simResult = this.simulateMainPhaseAction(simState, action);
        const newScore = this.evaluateBoard(simState, simState.bot);
        const delta = newScore - baseScore;
        if (delta > bestDelta) {
          bestDelta = delta;
          best = action;
        }
      }

      if (!best) break;

      improved = bestDelta > -0.01;
      actionsTaken += 1;
      this.executeMainPhaseAction(game, best);
    }

    setTimeout(() => game.nextPhase(), 800);
  }

  battlePhaseLogic(game) {
    // Threshold muito baixo para atacar mais agressivamente
    // -0.3 significa: aceita perder um pouco de valor se causar dano significativo
    const minDeltaToAttack = -0.3;

    const performAttack = () => {
      if (game.gameOver || game.phase !== "battle") {
        return;
      }

      const baseScore = this.evaluateBoard(game, this);
      let bestAttack = null;
      let bestDelta = -Infinity;

      // Ordenar atacantes por ATK decrescente para priorizar ataques fortes
      const sortedAttackers = [...this.field].sort(
        (a, b) => (b.atk || 0) - (a.atk || 0)
      );

      for (const attacker of sortedAttackers) {
        const availability = game.getAttackAvailability(attacker);
        if (!availability.ok) continue;

        // Se é segundo ataque de Moonblade, ser mais conservador (não aceitar perdas)
        const isSecondAttack =
          attacker.canMakeSecondAttackThisTurn &&
          (attacker.attacksUsedThisTurn || 0) >= 1;
        const attackThreshold = isSecondAttack ? 0.0 : minDeltaToAttack;

        const tauntTargets = game.player.field.filter(
          (card) =>
            card &&
            card.cardKind === "monster" &&
            !card.isFacedown &&
            card.mustBeAttacked
        );

        // Priorizar ataque direto se oponente não tem monstros
        const possibleTargets =
          tauntTargets.length > 0
            ? [...tauntTargets]
            : game.player.field.length
            ? [...game.player.field, null] // Incluir null para considerar ataque direto se possível
            : [null];

        for (const target of possibleTargets) {
          // Se há monstros no campo do oponente, não pode atacar diretamente
          if (target === null && game.player.field.length > 0) continue;

          const simState = this.cloneGameState(game);
          const simAttacker = simState.bot.field.find(
            (c) => c.id === attacker.id
          );
          const simTarget = target
            ? simState.player.field.find((c) => c.id === target.id)
            : null;

          if (!simAttacker) continue;

          this.simulateBattle(simState, simAttacker, simTarget);
          const scoreAfter = this.evaluateBoard(simState, simState.bot);
          let delta = scoreAfter - baseScore;

          // Bonus para ataque direto (causa dano ao oponente)
          if (target === null) {
            delta += 0.5;
          }
          // Bonus para destruir monstro sem perder o atacante
          if (target && simState.bot.field.find((c) => c.id === attacker.id)) {
            delta += 0.3;
          }

          if (delta > bestDelta) {
            bestDelta = delta;
            bestAttack = { attacker, target, threshold: attackThreshold };
          }
        }
      }

      // Usar threshold específico do ataque (pode ser diferente para segundo ataque)
      const finalThreshold = bestAttack?.threshold ?? minDeltaToAttack;
      if (bestAttack && bestDelta > finalThreshold) {
        game.resolveCombat(bestAttack.attacker, bestAttack.target);
        if (!game.gameOver) {
          setTimeout(() => performAttack(), 800);
        }
      } else {
        setTimeout(() => game.nextPhase(), 800);
      }
    };

    performAttack();
  }

  evaluateBoard(gameOrState, perspectivePlayer) {
    const opponent =
      typeof gameOrState.getOpponent === "function"
        ? gameOrState.getOpponent(perspectivePlayer)
        : gameOrState.player && perspectivePlayer.id === "bot"
        ? gameOrState.player
        : gameOrState.bot;
    const perspective = perspectivePlayer.id
      ? perspectivePlayer
      : gameOrState.bot;
    let score = 0;

    // Life points - reduzido peso para não priorizar LP sobre controle de campo
    score += (perspective.lp - opponent.lp) / 800;

    // Helper para verificar arquétipo Luminarch
    const isLuminarch = (card) => {
      if (!card) return false;
      const archetypes = Array.isArray(card.archetypes)
        ? card.archetypes
        : card.archetype
        ? [card.archetype]
        : [];
      return archetypes.includes("Luminarch");
    };

    // Monster presence com valorização Luminarch
    const monsterValue = (monster) => {
      const atk = (monster.atk || 0) + (monster.tempAtkBoost || 0);
      const def = (monster.def || 0) + (monster.tempDefBoost || 0);
      const base = monster.position === "defense" ? def : atk;
      let value = base / 1000 + (monster.level || 0) * 0.15;
      if (monster.cannotAttackThisTurn) value -= 0.2;
      if (monster.hasAttacked) value -= 0.05;

      // Bonus para monstros Luminarch com Citadel ativo
      if (
        perspective.fieldSpell &&
        perspective.fieldSpell.name === "Sanctum of the Luminarch Citadel"
      ) {
        if (isLuminarch(monster)) {
          value += 0.4;
        }
      }

      // Valorização especial para cartas-chave Luminarch
      if (
        monster.name === "Luminarch Aegisbearer" ||
        monster.name === "Luminarch Sanctum Protector"
      ) {
        value += 0.5; // Monstros de defesa/taunt são valiosos
      }
      if (monster.name === "Luminarch Aurora Seraph") {
        value += 1.2; // Boss principal
      }
      if (monster.name === "Luminarch Celestial Marshal") {
        value += 0.8; // Boss forte
      }
      if (monster.name === "Luminarch Radiant Lancer") {
        value += 1.0; // Boss com piercing
      }
      if (monster.name === "Luminarch Moonblade Captain") {
        value += 0.6; // Revive + double attack
      }

      // Monstros com taunt são mais valiosos defensivamente
      if (monster.mustBeAttacked) {
        value += 0.3;
      }

      return value;
    };

    const playerMonsters = perspective.field.reduce(
      (sum, m) => sum + monsterValue(m),
      0
    );
    const oppMonsters = opponent.field.reduce(
      (sum, m) => sum + monsterValue(m),
      0
    );
    score += playerMonsters - oppMonsters;

    // Field spell - valoriza Citadel
    if (perspective.fieldSpell) {
      score += 1.2;
      if (perspective.fieldSpell.name === "Sanctum of the Luminarch Citadel") {
        score += 0.8; // Citadel é muito bom para Luminarch
      }
    }
    score -= opponent.fieldSpell ? 0.8 : 0;

    // Equips on field (Crescent Shield, etc)
    score += perspective.spellTrap.length * 0.25;
    score -= opponent.spellTrap.length * 0.15;

    // Verificar se tem Holy Shield na spellTrap zone (proteção ativa)
    const hasHolyShieldActive = perspective.spellTrap.some(
      (c) => c.name === "Luminarch Holy Shield"
    );
    if (hasHolyShieldActive) {
      score += 0.5;
    }

    // Hand advantage
    score += (perspective.hand.length - opponent.hand.length) * 0.3;

    // Graveyard synergies para Luminarch
    const hasReviver = perspective.hand.some((c) =>
      [
        "Monster Reborn",
        "Luminarch Moonlit Blessing",
        "Luminarch Sacred Judgment",
      ].includes(c.name)
    );
    if (hasReviver) {
      const bestGY = perspective.graveyard.reduce(
        (max, c) =>
          c.cardKind === "monster" && isLuminarch(c)
            ? Math.max(max, c.atk || 0)
            : max,
        0
      );
      score += bestGY / 2000;
    }

    // Valorizar ter Convocation na mão com monstros Luminarch de alto nível no GY
    const hasConvocation = perspective.hand.some(
      (c) => c.name === "Luminarch Knights Convocation"
    );
    const hasHighLevelInGY = perspective.graveyard.some(
      (c) => isLuminarch(c) && c.cardKind === "monster" && (c.level || 0) >= 7
    );
    if (hasConvocation && hasHighLevelInGY) {
      score += 0.7;
    }

    // LP safety check: penaliza se LP for muito baixo e oponente pode usar Sacred Judgment
    if (perspective.lp < 2000) {
      const oppHasSacredJudgment = opponent.hand.some(
        (c) => c.name === "Luminarch Sacred Judgment"
      );
      if (oppHasSacredJudgment) {
        score -= 0.5; // Penaliza posição insegura
      }
    }

    // Follow-up potential: bonus if hand has multiple playable spells/monsters
    const playableCards = perspective.hand.filter((c) => {
      if (c.cardKind === "monster") {
        const tributes = this.getTributeRequirement(c);
        return perspective.field.length >= tributes.tributesNeeded;
      }
      return c.cardKind === "spell";
    });
    if (playableCards.length >= 3) {
      score += 0.4; // Hand tem sequência potencial
    }

    // Opponent taunt penalty: if opp has taunt, they're more of a threat
    const oppTauntCount = opponent.field.filter(
      (m) => m && m.mustBeAttacked
    ).length;
    if (oppTauntCount > 0) {
      score -= oppTauntCount * 0.2; // Each taunt limits bot's options
    }

    return score;
  }

  generateMainPhaseActions(game) {
    let actions = [];

    // Summon / Set monsters
    this.hand.forEach((card, index) => {
      if (card.cardKind !== "monster") return;
      if (this.summonCount >= 1) return;
      const tributeInfo = this.getTributeRequirement(card);
      if (this.field.length < tributeInfo.tributesNeeded) return;

      actions.push({
        type: "summon",
        index,
        position: "attack",
        facedown: false,
      });
      actions.push({
        type: "summon",
        index,
        position: "defense",
        facedown: true,
      });
    });

    // Helper: Check if card has Luminarch archetype
    const hasLuminarchArchetype = (c) => {
      const archetypes = Array.isArray(c.archetypes)
        ? c.archetypes
        : c.archetype
        ? [c.archetype]
        : [];
      return archetypes.includes("Luminarch");
    };

    // Spells
    this.hand.forEach((card, index) => {
      if (card.cardKind !== "spell") return;
      const check = game.effectEngine.canActivate(card, this);
      if (!check.ok) return;

      // Extra heuristics para Luminarch
      if (card.name === "Luminarch Holy Shield") {
        // Só usar Holy Shield se tiver monstros Luminarch para proteger
        const luminarchOnField = this.field.filter(hasLuminarchArchetype);
        if (luminarchOnField.length === 0) return;
      }
      if (card.name === "Luminarch Moonlit Blessing") {
        // Só usar se tiver Luminarch no GY para recuperar
        const gyHasLuminarch = this.graveyard.some(
          (c) => hasLuminarchArchetype(c) && c.cardKind === "monster"
        );
        if (!gyHasLuminarch) return;
      }
      if (card.name === "Luminarch Sacred Judgment") {
        // Só usar Sacred Judgment se não controlar monstros (é a condição da carta)
        if (this.field.length > 0) return;
        // Oponente precisa controlar 2+ monstros (condição da carta)
        if (game.player.field.length < 2) return;
        // Precisa ter Luminarch no GY
        const gyHasLuminarch = this.graveyard.some(
          (c) => hasLuminarchArchetype(c) && c.cardKind === "monster"
        );
        if (!gyHasLuminarch) return;
        // Precisa ter LP suficiente para pagar o custo
        if (this.lp < 2000) return;
      }
      if (card.name === "Luminarch Knights Convocation") {
        // Precisa ter Luminarch lv7+ na mão para descartar
        const hasHighLevel = this.hand.some((c) => {
          if (c === card) return false;
          return (
            hasLuminarchArchetype(c) &&
            c.cardKind === "monster" &&
            (c.level || 0) >= 7
          );
        });
        if (!hasHighLevel) return;

        // Additional payoff check: Convocation is valuable if we have targets to search
        // Check if there are valuable Luminarch monsters available to search
        // (Moonlit, Arbiter, Enchanted Halberd, or boss monsters)
        const hasBossInDeck = cardDatabase.some(
          (c) =>
            hasLuminarchArchetype(c) &&
            (c.name.includes("Marshal") ||
              c.name.includes("Lancer") ||
              c.name.includes("Seraph"))
        );
        if (!hasBossInDeck && !this.graveyard.some(
          (c) =>
            hasLuminarchArchetype(c) &&
            c.cardKind === "monster" &&
            (c.name.includes("Arbiter") ||
              c.name.includes("Enchanted") ||
              c.name === "Luminarch Moonlit Blessing")
        )) {
          return; // Skip Convocation if no valuable search targets exist
        }
      }
      if (card.subtype === "field") {
        if (this.fieldSpell) {
          // Prefer not replacing unless field is missing
          if (this.fieldSpell.name === card.name) return;
        }
        // Field spell activation: only if strategic payoff exists
        if (card.name === "Sanctum of the Luminarch Citadel") {
          // Citadel is most valuable if we have Luminarch monsters on field
          const luminarchOnField = this.field.filter(hasLuminarchArchetype);
          if (luminarchOnField.length === 0 && !this.hand.some(
            (c) =>
              c.cardKind === "monster" &&
              hasLuminarchArchetype(c) &&
              this.getTributeRequirement(c).tributesNeeded <= this.field.length
          )) {
            return; // Skip Citadel if no Luminarch to leverage it
          }
        }
      }

      actions.push({ type: "spell", index });
    });

    // Field spell activated effects
    if (this.fieldSpell) {
      const effect = (this.fieldSpell.effects || []).find(
        (e) => e.timing === "on_field_activate"
      );
      if (effect) {
        const optCheck = game.effectEngine.checkOncePerTurn(
          this.fieldSpell,
          this,
          effect
        );
        if (optCheck.ok) {
          actions.push({ type: "fieldEffect" });
        }
      }
    }

    // FUTURE: Fusion support (post-base-improvement)
    // TODO: Add Polymerization action generation
    // - Check if extra deck has available fusions
    // - Check if field + hand have valid material combos
    // - Estimate payoff: fusion ATK vs material sacrifice + field space
    // - Prioritize fusion if: (1) stronger than summon alternative, (2) enables boss setup
    // - Avoid: sacrificing Aegisbearer/taunt unless fusion is much stronger
    // - Position: Polymerization after all Citadel/shield setup for maximum synergy

    // Reorder spells for optimal combo sequencing
    actions = this.sequenceActions(actions);

    return actions;
  }

  sequenceActions(actions) {
    // Separate by type for easier reordering
    const summons = actions.filter((a) => a.type === "summon");
    const spells = actions.filter((a) => a.type === "spell");
    const fieldEffects = actions.filter((a) => a.type === "fieldEffect");

    // Helper: get spell card name by index
    const getSpellName = (index) => this.hand[index]?.name || "";

    // Spell priority order for Luminarch
    const spellPriority = {
      "Sanctum of the Luminarch Citadel": 10, // Field spell first
      "Luminarch Sacred Judgment": 9, // Revive/setup before other spells
      "Luminarch Moonlit Blessing": 8, // Revive enabler
      "Luminarch Holy Shield": 7, // Protect before exposing bosses
      "Luminarch Knights Convocation": 6, // Search for setup
      "Luminarch Holy Ascension": 5, // Buff support
      "Luminarch Crescent Shield": 4, // Defensive buff
    };

    // Sort spells by priority
    spells.sort((a, b) => {
      const nameA = getSpellName(a.index);
      const nameB = getSpellName(b.index);
      const priorityA = spellPriority[nameA] ?? 0;
      const priorityB = spellPriority[nameB] ?? 0;
      return priorityB - priorityA; // Higher priority first
    });

    // Reorder: Citadel → Sacred Judgment → Shield → Convocation → Moonlit → others → summons
    const reordered = [];
    reordered.push(...spells.filter((a) => getSpellName(a.index) === "Sanctum of the Luminarch Citadel"));
    reordered.push(...spells.filter((a) => getSpellName(a.index) === "Luminarch Sacred Judgment"));
    reordered.push(...spells.filter((a) => ["Luminarch Holy Shield", "Luminarch Crescent Shield"].includes(getSpellName(a.index))));
    reordered.push(...spells.filter((a) => getSpellName(a.index) === "Luminarch Knights Convocation"));
    reordered.push(...spells.filter((a) => getSpellName(a.index) === "Luminarch Moonlit Blessing"));
    reordered.push(...spells.filter((a) => !reordered.includes(a))); // Remaining spells
    reordered.push(...summons);
    reordered.push(...fieldEffects);

    return reordered;
  }

  getTributeRequirementFor(card, playerState) {
    let tributesNeeded = 0;
    if (card.level >= 5 && card.level <= 6) tributesNeeded = 1;
    else if (card.level >= 7) tributesNeeded = 2;

    let usingAlt = false;
    const alt = card.altTribute;
    if (
      alt?.type === "no_tribute_if_empty_field" &&
      (playerState.field?.length || 0) === 0 &&
      tributesNeeded > 0
    ) {
      tributesNeeded = 0;
      usingAlt = true;
    }
    if (alt && playerState.field?.some((c) => c.name === alt.requiresName)) {
      if (alt.tributes < tributesNeeded) {
        tributesNeeded = alt.tributes;
        usingAlt = true;
      }
    }

    return { tributesNeeded, usingAlt, alt };
  }

  // Seleciona os melhores monstros para usar como tributo (os PIORES do campo)
  selectBestTributes(field, tributesNeeded, cardToSummon) {
    if (tributesNeeded <= 0 || !field || field.length < tributesNeeded) {
      return [];
    }

    // Calcular valor de cada monstro no campo
    const monstersWithValue = field.map((monster, index) => {
      let value = 0;
      const atk = monster.atk || 0;
      const def = monster.def || 0;
      const level = monster.level || 0;

      // Valor base: ATK é o principal indicador de força
      value += atk / 500;
      value += def / 1000;
      value += level * 0.2;

      // Penalizar monstros que são claramente importantes
      const importantMonsters = [
        "Luminarch Aurora Seraph",
        "Luminarch Celestial Marshal",
        "Luminarch Radiant Lancer",
        "Luminarch Sanctum Protector",
        "Luminarch Moonblade Captain",
        "Luminarch Aegisbearer",
      ];
      if (importantMonsters.includes(monster.name)) {
        value += 5; // Muito importante, evitar tributar
      }

      // Monstros com taunt são importantes para defesa
      if (monster.mustBeAttacked) {
        value += 2;
      }

      // Monstros com efeitos contínuos são mais valiosos
      if (
        monster.effects &&
        monster.effects.some(
          (e) => e.timing === "passive" || e.timing === "continuous"
        )
      ) {
        value += 1;
      }

      // Tokens e monstros fracos são ideais para tributo
      if (monster.isToken || monster.name.includes("Token")) {
        value -= 3;
      }
      if (atk <= 1000 && level <= 4) {
        value -= 1; // Monstros fracos são bons tributos
      }

      return { monster, index, value };
    });

    // Ordenar por valor ASCENDENTE (menores valores = piores monstros = melhores tributos)
    monstersWithValue.sort((a, b) => a.value - b.value);

    // Verificar se o monstro a invocar vale a pena (não tributar algo melhor)
    const summonAtk = cardToSummon.atk || 0;
    const summonValue = summonAtk / 500 + (cardToSummon.level || 0) * 0.2;

    // Se vamos sacrificar algo muito forte para algo mais fraco, reconsiderar
    const tributeCandidates = monstersWithValue.slice(0, tributesNeeded);
    const totalTributeValue = tributeCandidates.reduce(
      (sum, t) => sum + t.value,
      0
    );

    // Se o valor total dos tributos é maior que o monstro invocado, ainda retorna
    // mas a simulação vai avaliar se vale a pena

    return tributeCandidates.map((t) => t.index);
  }

  simulateMainPhaseAction(state, action) {
    if (!action) return state;

    switch (action.type) {
      case "summon": {
        const player = state.bot;
        const card = player.hand[action.index];
        if (!card) break;
        const tributeInfo = this.getTributeRequirementFor(card, player);
        const tributesNeeded = tributeInfo.tributesNeeded;

        // Escolher tributos inteligentemente: sacrificar os PIORES monstros
        const tributeIndices = this.selectBestTributes(
          player.field,
          tributesNeeded,
          card
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
        this.simulateSpellEffect(state, card);
        player.hand.splice(action.index, 1);
        player.graveyard.push(card);
        break;
      }
      case "fieldEffect": {
        const player = state.bot;
        if (player.fieldSpell && player.fieldSpell.name === "Darkness Valley") {
          player.field.forEach((m) => {
            if (m.archetypes?.includes("Shadow-Heart")) {
              m.atk += 300;
            }
          });
        }
        // Citadel não tem efeito de ativação manual, só passivo
        break;
      }
      default:
        break;
    }

    return state;
  }

  simulateSpellEffect(state, card) {
    const player = state.bot;
    const opponent = state.player;

    switch (card.name) {
      case "Arcane Surge":
        player.hand.push({ placeholder: true }, { placeholder: true });
        break;
      case "Shadow Purge": {
        const target = opponent.field
          .slice()
          .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
        if (target) {
          const idx = opponent.field.indexOf(target);
          opponent.field.splice(idx, 1);
          opponent.graveyard.push(target);
        }
        break;
      }
      case "Blood Sucking":
        player.lp += 1000;
        break;
      case "Cheap Necromancy": {
        if (player.field.length < 5) {
          player.field.push({
            name: "Summoned Imp Token",
            atk: 500,
            def: 500,
            level: 1,
            position: "attack",
            isFacedown: false,
            hasAttacked: false,
            attacksUsedThisTurn: 0,
            cardKind: "monster",
          });
        }
        break;
      }
      case "Shadow Coat": {
        const target = player.field.sort(
          (a, b) => (b.atk || 0) - (a.atk || 0)
        )[0];
        if (target) {
          target.atk += 1000;
          target.tempAtkBoost = (target.tempAtkBoost || 0) + 1000;
        }
        break;
      }
      case "Infinity Searcher":
        player.hand.push({ placeholder: true });
        break;
      case "Transmutate": {
        if (
          player.field.length &&
          player.graveyard.length &&
          player.field.length < 5
        ) {
          const sent = player.field.shift();
          player.graveyard.push(sent);
          const level = sent.level || 0;
          const candidate = player.graveyard
            .filter((c) => c.level === level && c.cardKind === "monster")
            .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
          if (candidate) {
            const idx = player.graveyard.indexOf(candidate);
            player.graveyard.splice(idx, 1);
            candidate.position = "attack";
            candidate.hasAttacked = false;
            candidate.attacksUsedThisTurn = 0;
            player.field.push(candidate);
          }
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
          const ownerGrave = player.graveyard.includes(best)
            ? player.graveyard
            : opponent.graveyard;
          const idx = ownerGrave.indexOf(best);
          ownerGrave.splice(idx, 1);
          best.position = "attack";
          best.hasAttacked = false;
          best.attacksUsedThisTurn = 0;
          player.field.push(best);
        }
        break;
      }
      case "Shadow Recall": {
        if (player.field.length) {
          const bounce = player.field.pop();
          player.hand.push(bounce);
        }
        break;
      }
      case "Shadow-Heart Infusion": {
        if (player.hand.length >= 2 && player.field.length < 5) {
          const discards = player.hand.splice(0, 2);
          player.graveyard.push(...discards);
          const target = player.graveyard
            .filter(
              (c) =>
                c.archetypes?.includes("Shadow-Heart") &&
                c.cardKind === "monster"
            )
            .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
          if (target) {
            const idx = player.graveyard.indexOf(target);
            player.graveyard.splice(idx, 1);
            target.position = "attack";
            target.cannotAttackThisTurn = true;
            target.hasAttacked = false;
            target.attacksUsedThisTurn = 0;
            player.field.push(target);
          }
        }
        break;
      }
      case "Shadow-Heart Invocation": {
        const shMonsters = player.field.filter((c) =>
          c.archetypes?.includes("Shadow-Heart")
        );
        const uniqueNames = new Set(shMonsters.map((c) => c.name));
        if (
          uniqueNames.size >= 3 &&
          player.field.length >= 3 &&
          player.field.length <= 5
        ) {
          const tributes = shMonsters.slice(0, 3);
          tributes.forEach((t) => {
            const idx = player.field.indexOf(t);
            if (idx > -1) {
              player.field.splice(idx, 1);
              player.graveyard.push(t);
            }
          });
          const dragon =
            player.hand.find((c) => c.name === "Shadow-Heart Scale Dragon") ||
            player.graveyard.find(
              (c) => c.name === "Shadow-Heart Scale Dragon"
            );
          if (dragon) {
            const fromGY = player.graveyard.includes(dragon);
            if (fromGY) {
              const idx = player.graveyard.indexOf(dragon);
              player.graveyard.splice(idx, 1);
            } else {
              const idx = player.hand.indexOf(dragon);
              player.hand.splice(idx, 1);
            }
            dragon.position = "attack";
            dragon.hasAttacked = false;
            dragon.attacksUsedThisTurn = 0;
            player.field.push(dragon);
          }
        }
        break;
      }
      case "Shadow-Heart Shield": {
        const target = player.field.sort(
          (a, b) => (b.atk || 0) - (a.atk || 0)
        )[0];
        if (target) {
          target.atk += 500;
          target.def += 500;
          target.battleIndestructible = true;
        }
        break;
      }
      case "Darkness Valley": {
        player.fieldSpell = { ...card };
        player.field.forEach((m) => {
          if (m.archetypes?.includes("Shadow-Heart")) {
            m.atk += 300;
          }
        });
        break;
      }
      // Spells Luminarch
      case "Sanctum of the Luminarch Citadel": {
        player.fieldSpell = { ...card };
        // Citadel buffa Luminarch
        break;
      }
      case "Luminarch Holy Shield": {
        // Protege até 3 monstros Luminarch de destruição em batalha
        // Simular como aumento de valor defensivo
        player.field.forEach((m) => {
          const archetypes = Array.isArray(m.archetypes)
            ? m.archetypes
            : m.archetype
            ? [m.archetype]
            : [];
          if (archetypes.includes("Luminarch")) {
            m.battleIndestructible = true;
          }
        });
        break;
      }
      case "Luminarch Moonlit Blessing": {
        // Adiciona Luminarch do GY à mão
        const target = player.graveyard
          .filter((c) => {
            const archetypes = Array.isArray(c.archetypes)
              ? c.archetypes
              : c.archetype
              ? [c.archetype]
              : [];
            return archetypes.includes("Luminarch") && c.cardKind === "monster";
          })
          .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
        if (target) {
          const idx = player.graveyard.indexOf(target);
          player.graveyard.splice(idx, 1);
          player.hand.push(target);
        }
        break;
      }
      case "Luminarch Holy Ascension": {
        player.lp -= 1000;
        const target = player.field.sort(
          (a, b) => (b.atk || 0) - (a.atk || 0)
        )[0];
        if (target) {
          target.atk += 800;
          target.def += 800;
        }
        break;
      }
      case "Luminarch Crescent Shield": {
        const target = player.field.sort(
          (a, b) => (b.def || 0) - (a.def || 0)
        )[0];
        if (target) {
          target.def += 500;
          target.battleIndestructible = true;
        }
        break;
      }
      case "Luminarch Sacred Judgment": {
        // Paga 2000 LP para reviver múltiplos Luminarch
        player.lp -= 2000;
        const maxToRevive = Math.min(opponent.field.length, 5 - player.field.length);
        const candidates = player.graveyard
          .filter((c) => {
            const archetypes = Array.isArray(c.archetypes)
              ? c.archetypes
              : c.archetype
              ? [c.archetype]
              : [];
            return archetypes.includes("Luminarch") && c.cardKind === "monster";
          })
          .sort((a, b) => (b.atk || 0) - (a.atk || 0))
          .slice(0, maxToRevive);

        candidates.forEach((card) => {
          const idx = player.graveyard.indexOf(card);
          if (idx > -1) {
            player.graveyard.splice(idx, 1);
            const revived = { ...card };
            revived.position = "attack";
            revived.hasAttacked = false;
            revived.attacksUsedThisTurn = 0;
            player.field.push(revived);
          }
        });
        break;
      }
      case "Luminarch Knights Convocation": {
        // Descarta Luminarch lv7+ para buscar qualquer Luminarch
        // Simular como ganho de mão (qualidade representada pela busca)
        const discardCandidates = player.hand
          .filter((c) => {
            const archetypes = Array.isArray(c.archetypes)
              ? c.archetypes
              : c.archetype
              ? [c.archetype]
              : [];
            return archetypes.includes("Luminarch") && (c.level || 0) >= 7;
          })
          .sort((a, b) => (a.atk || 0) - (b.atk || 0)); // Discard weakest

        if (discardCandidates.length > 0) {
          const toDiscard = discardCandidates[0];
          const discardIdx = player.hand.indexOf(toDiscard);
          player.hand.splice(discardIdx, 1);
          player.graveyard.push(toDiscard);

          // Buscar: simulado como placeholder representando vantagem
          // Em vez de verdadeira busca de deck, adiciona valor à mão
          player.hand.push({ placeholder: true, type: "convocation_search" });
        }
        break;
      }
      default:
        break;
    }
  }

  simulateBattle(state, attacker, target) {
    if (!attacker) return;
    if (attacker.cannotAttackThisTurn) return;
    if (attacker.position === "defense") return;

    const maxAttacks = 1 + (attacker.extraAttacks || 0);
    const usedAttacks = attacker.attacksUsedThisTurn || 0;
    if (usedAttacks >= maxAttacks) return;

    const attackerOwner = state.bot;
    const defenderOwner = state.player;

    const attackStat = attacker.atk || 0;
    if (!target) {
      defenderOwner.lp -= attackStat;
      attacker.attacksUsedThisTurn = usedAttacks + 1;
      attacker.hasAttacked = attacker.attacksUsedThisTurn >= maxAttacks;
      return;
    }

    const targetStat =
      target.position === "attack" ? target.atk || 0 : target.def || 0;
    if (target.position === "attack") {
      if (attackStat > targetStat) {
        defenderOwner.lp -= attackStat - targetStat;
        defenderOwner.graveyard.push(target);
        defenderOwner.field.splice(defenderOwner.field.indexOf(target), 1);
      } else if (attackStat < targetStat) {
        attackerOwner.lp -= targetStat - attackStat;
        attackerOwner.graveyard.push(attacker);
        attackerOwner.field.splice(attackerOwner.field.indexOf(attacker), 1);
      } else {
        attackerOwner.graveyard.push(attacker);
        defenderOwner.graveyard.push(target);
        attackerOwner.field.splice(attackerOwner.field.indexOf(attacker), 1);
        defenderOwner.field.splice(defenderOwner.field.indexOf(target), 1);
      }
    } else {
      if (attackStat > targetStat) {
        defenderOwner.graveyard.push(target);
        defenderOwner.field.splice(defenderOwner.field.indexOf(target), 1);
      } else if (attackStat < targetStat) {
        attackerOwner.lp -= targetStat - attackStat;
      }
    }
    attacker.attacksUsedThisTurn = usedAttacks + 1;
    attacker.hasAttacked = attacker.attacksUsedThisTurn >= maxAttacks;
  }

  executeMainPhaseAction(game, action) {
    if (!action) return;

    if (action.type === "summon") {
      const cardToSummon = this.hand[action.index];
      if (!cardToSummon) return;

      // Calcular tributos necessários e selecionar os melhores (piores monstros)
      const tributeInfo = this.getTributeRequirement(cardToSummon);
      let tributeIndices = null;

      if (tributeInfo.tributesNeeded > 0) {
        tributeIndices = this.selectBestTributes(
          this.field,
          tributeInfo.tributesNeeded,
          cardToSummon
        );
      }

      const card = this.summon(
        action.index,
        action.position,
        action.facedown,
        tributeIndices
      );
      if (card) {
        game.renderer.log(
          `Bot summons ${action.facedown ? "a monster in defense" : card.name}`
        );
        game.updateBoard();
      }
      return;
    }

    if (action.type === "spell") {
      const card = this.hand[action.index];
      if (!card) return;
      const selections = this.buildAutoSelections(card, game);
      let result = game.effectEngine.activateFromHand(
        card,
        this,
        action.index,
        selections
      );

      if (result && result.needsSelection && result.options) {
        const auto = this.convertOptionsToSelection(result.options);
        if (auto) {
          result = game.effectEngine.activateFromHand(
            card,
            this,
            action.index,
            auto
          );
        }
      }
      if (!result?.success) {
        console.log("Bot failed to activate spell:", result?.reason);
      } else {
        game.renderer.log(`Bot activates ${card.name}`);
        game.updateBoard();
      }
      return;
    }

    if (action.type === "fieldEffect" && this.fieldSpell) {
      const selections = this.buildAutoSelections(this.fieldSpell, game);
      const result = game.effectEngine.activateFieldSpell(
        this.fieldSpell,
        this,
        selections
      );
      if (!result?.success) {
        console.log("Bot failed field effect:", result?.reason);
      } else {
        game.renderer.log(`Bot activates ${this.fieldSpell.name}'s effect`);
        game.updateBoard();
      }
    }
  }

  buildAutoSelections(card, game) {
    if (!card || !card.effects) return null;

    const effect = card.effects.find(
      (e) => e.timing === "on_play" || e.timing === "on_field_activate"
    );
    if (!effect || !effect.targets) return null;

    // Helper: Check if card has Luminarch archetype
    const hasLuminarchArchetype = (c) => {
      const archetypes = Array.isArray(c.archetypes)
        ? c.archetypes
        : c.archetype
        ? [c.archetype]
        : [];
      return archetypes.includes("Luminarch");
    };

    // Helper: Evaluate card value (ATK + archetype bonus + special boss bonus)
    const evaluateCardValue = (c) => {
      let value = c.atk || 0;
      if (hasLuminarchArchetype(c)) {
        value += 500; // Luminarch bonus
        // Boss bonus
        if (
          c.name.includes("Marshal") ||
          c.name.includes("Lancer") ||
          c.name.includes("Seraph") ||
          c.name.includes("Moonblade")
        ) {
          value += 300;
        }
      }
      return value;
    };

    const selections = {};
    effect.targets.forEach((targetDef) => {
      const candidates = game.effectEngine.selectCandidates(targetDef, {
        source: card,
        player: this,
        opponent: game.player,
      });
      if (!candidates?.candidates?.length) return;

      let chosen = [0];
      if (card.name === "Monster Reborn") {
        let bestIdx = 0;
        let bestAtk = -Infinity;
        candidates.candidates.forEach((c, idx) => {
          if (c.cardKind === "monster" && (c.atk || 0) > bestAtk) {
            bestAtk = c.atk || 0;
            bestIdx = idx;
          }
        });
        chosen = [bestIdx];
      } else if (
        card.name === "Shadow-Heart Shield" ||
        card.name === "Shadow Coat" ||
        card.name === "Luminarch Holy Ascension" ||
        card.name === "Luminarch Crescent Shield"
      ) {
        // Escolher o monstro mais forte para buffs
        let bestIdx = 0;
        let bestValue = -Infinity;
        candidates.candidates.forEach((c, idx) => {
          const value = evaluateCardValue(c);
          if (value > bestValue) {
            bestValue = value;
            bestIdx = idx;
          }
        });
        chosen = [bestIdx];
      } else if (card.name === "Luminarch Holy Shield") {
        // Escolher até 3 monstros Luminarch para proteger
        // Priorize by value (ATK + Citadel bonus if present)
        const luminarchCandidates = candidates.candidates
          .map((c, idx) => ({
            idx,
            card: c,
            value: evaluateCardValue(c),
          }))
          .filter((item) => hasLuminarchArchetype(item.card))
          .sort((a, b) => b.value - a.value)
          .slice(0, 3);

        chosen =
          luminarchCandidates.length > 0
            ? luminarchCandidates.map((item) => item.idx)
            : [0];
      } else if (card.name === "Luminarch Moonlit Blessing") {
        // Escolher o Luminarch mais forte do GY
        // Bonus se Citadel está no campo (special summon é possível)
        const citadelBonus = this.fieldSpell?.name === "Sanctum of the Luminarch Citadel" ? 200 : 0;
        let bestIdx = 0;
        let bestValue = -Infinity;
        candidates.candidates.forEach((c, idx) => {
          if (hasLuminarchArchetype(c)) {
            let value = c.atk || 0;
            value += citadelBonus; // Boost if Citadel is present
            if (value > bestValue) {
              bestValue = value;
              bestIdx = idx;
            }
          }
        });
        chosen = [bestIdx];
      } else if (card.name === "Luminarch Sacred Judgment") {
        // Escolher múltiplos Luminarch do GY para reviver
        // Priorize by ATK, respect field capacity (max 5)
        // Select highest ATK monsters to maximize board pressure
        const maxSummons = Math.min(
          targetDef.count?.max || 3,
          5 - this.field.length
        );
        const luminarchCandidates = candidates.candidates
          .map((c, idx) => ({
            idx,
            card: c,
            atk: c.atk || 0,
          }))
          .filter(
            (item) => hasLuminarchArchetype(item.card) && item.card.cardKind === "monster"
          )
          .sort((a, b) => b.atk - a.atk)
          .slice(0, maxSummons);

        if (luminarchCandidates.length > 0) {
          console.log(
            `[Sacred Judgment] Summoning ${luminarchCandidates.length} monsters: ${luminarchCandidates.map((c) => c.card.name).join(", ")}`
          );
        }

        chosen =
          luminarchCandidates.length > 0
            ? luminarchCandidates.map((item) => item.idx)
            : [];
      } else if (card.name === "Luminarch Knights Convocation") {
        // Convocation: Discard Luminarch lv7+ to search any Luminarch
        // Strategy: Discard weakest lv7+ to minimize loss
        // The search target will be handled in follow-up selection
        let discardIdx = -1;
        let lowestValue = Infinity;
        candidates.candidates.forEach((c, idx) => {
          if (hasLuminarchArchetype(c) && (c.level || 0) >= 7) {
            const value = evaluateCardValue(c);
            if (value < lowestValue) {
              lowestValue = value;
              discardIdx = idx;
            }
          }
        });

        // Log selection for debugging
        if (discardIdx >= 0) {
          const discardCard = candidates.candidates[discardIdx];
          console.log(
            `[Convocation] Discarding ${discardCard.name} (value ${evaluateCardValue(discardCard)}) to search.`
          );
        }

        chosen = discardIdx >= 0 ? [discardIdx] : [0];
      } else if (card.name === "Shadow-Heart Infusion") {
        chosen = candidates.candidates.map((_, idx) => idx).slice(0, 2);
      } else if (card.name === "Shadow-Heart Invocation") {
        const indices = [];
        const usedNames = new Set();
        candidates.candidates.forEach((c, idx) => {
          if (!usedNames.has(c.name) && indices.length < 3) {
            usedNames.add(c.name);
            indices.push(idx);
          }
        });
        chosen = indices;
      }

      selections[targetDef.id] = chosen;
    });

    return selections;
  }

  convertOptionsToSelection(options) {
    if (!Array.isArray(options)) return null;
    const selections = {};
    for (const opt of options) {
      if (!opt || !Array.isArray(opt.candidates)) continue;
      const pickCount = Math.max(1, opt.min || 0);
      const chosen = [];
      for (let i = 0; i < Math.min(pickCount, opt.candidates.length); i++) {
        chosen.push(i);
      }
      if (chosen.length) {
        selections[opt.id] = chosen;
      }
    }
    return Object.keys(selections).length ? selections : null;
  }

  cloneGameState(game) {
    const clonePlayer = (p) => {
      return {
        id: p.id,
        lp: p.lp,
        hand: p.hand.map((c) => ({ ...c })),
        field: p.field.map((c) => ({ ...c })),
        graveyard: p.graveyard.map((c) => ({ ...c })),
        fieldSpell: p.fieldSpell ? { ...p.fieldSpell } : null,
        spellTrap: p.spellTrap ? p.spellTrap.map((c) => ({ ...c })) : [],
        summonCount: p.summonCount || 0,
      };
    };

    return {
      player: clonePlayer(game.player),
      bot: clonePlayer(this),
      turn: game.turn,
      phase: game.phase,
      turnCounter: game.turnCounter || 0,
      // Clone once-per-turn tracking from effectEngine if available
      usedThisTurn: game.effectEngine?.usedThisTurn
        ? new Map(game.effectEngine.usedThisTurn)
        : new Map(),
    };
  }
}
