import Player from "./Player.js";
import { cardDatabase, cardDatabaseById } from "../data/cards.js";
import Card from "./Card.js";
import { getStrategyFor } from "./ai/StrategyRegistry.js";
import { beamSearchTurn, greedySearchWithEvalV2 } from "./ai/BeamSearch.js";
import { botLogger } from "./BotLogger.js";

export default class Bot extends Player {
  constructor(archetype = "shadowheart") {
    super("bot", "Opponent", "ai");
    this.maxSimulationsPerPhase = 20;
    this.maxChainedActions = 6; // Aumentado de 3 para 6 - permite múltiplas ações + efeitos
    this.setPreset(archetype);
  }
  static getAvailablePresets() {
    return [
      { id: "shadowheart", label: "Shadow-Heart" },
      { id: "luminarch", label: "Luminarch" },
    ];
  }

  setPreset(presetId = "shadowheart") {
    const validIds = Bot.getAvailablePresets().map((p) => p.id);
    this.archetype = validIds.includes(presetId) ? presetId : "shadowheart";

    this.strategy = getStrategyFor(this.archetype, this);
  }

  // Sobrescreve buildDeck para usar deck do arquétipo selecionado
  buildDeck() {
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

    // Seleciona deck baseado no arquétipo
    const deckList =
      this.archetype === "shadowheart"
        ? this.getShadowHeartDeck()
        : this.getLuminarchDeck();

    for (const cardId of deckList) {
      const data = cardDatabaseById.get(cardId);
      if (data) {
        addCard(data);
      }
    }

    this.shuffleDeck();
  }

  // Deck Shadow-Heart otimizado para combos e fusões
  getShadowHeartDeck() {
    return [
      // === MONSTROS ===
      // Extenders e Searchers
      60,
      60,
      60, // Shadow-Heart Imp (extender - 3x)
      61, // Shadow-Heart Gecko (draw engine - 1x)
      53,
      53, // Shadow-Heart Specter (recursão GY - 2x)
      62,
      62, // Shadow-Heart Coward (discard value - 2x)
      52,
      52, // Shadow-Heart Abyssal Eel (utility - 2x)
      70, // Shadow-Heart Leviathan (burn beater - 1x)
      69, // Shadow-Heart Death Wyrm (hand trap boss - 1x)
      // Bosses
      64,
      64, // Shadow-Heart Scale Dragon (boss 3000 ATK - 2x)
      57, // Shadow-Heart Demon Arctroth (boss com remoção - 1x)
      67,
      67, // Shadow-Heart Griffin (sem tributo - 2x)
      71,
      71, // Shadow-Heart Void Mage (buscador de spell/trap - 2x)
      // === SPELLS ===
      13,
      13, // Polymerization (fusão - 2x)
      68,
      68, // Darkness Valley (field spell - 2x)
      63,
      63, // Shadow-Heart Infusion (revive - 2x)
      59,
      59, // Shadow-Heart Covenant (searcher - 2x)
      58, // Shadow-Heart Battle Hymn (buff - 1x)
      65, // Shadow-Heart Rage (OTK enabler - 1x)
      54, // Shadow-Heart Purge (remoção - 1x)
      66, // Shadow-Heart Shield (proteção - 1x)
      73,
      73, // The Shadow Heart (recuperação de board - 2x)
    ];
  }

  // Deck Luminarch completo (Tank/Control/Versatility) — 30 cards
  getLuminarchDeck() {
    return [
      // ═════════════════════════════════════════════════════════════════════
      // S-TIER CORE — 8 cards
      // ═════════════════════════════════════════════════════════════════════
      112,
      112,
      112, // Sanctum of the Luminarch Citadel (field spell S-tier, priority 22)
      103,
      103,
      103, // Luminarch Aegisbearer (taunt tank S-tier, priority 20)
      102,
      102, // Luminarch Holy Shield (proteção S-tier, priority 20)

      // ═════════════════════════════════════════════════════════════════════
      // A-TIER SEARCHERS & RECURSION — 6 cards
      // ═════════════════════════════════════════════════════════════════════
      101,
      101, // Luminarch Valiant – Knight of the Dawn (searcher A-tier, priority 18)
      118,
      118, // Luminarch Moonlit Blessing (recursion A-tier, priority 17)
      110,
      110, // Luminarch Sanctified Arbiter (busca Citadel, A-tier, priority 16)

      // ═════════════════════════════════════════════════════════════════════
      // A-TIER BOSS BEATERS — 5 cards (Lv6-8)
      // ═════════════════════════════════════════════════════════════════════
      104,
      104, // Luminarch Moonblade Captain (Lv6 recursion + double atk, priority 16)
      105, // Luminarch Celestial Marshal (Lv7 boss 2500 ATK, priority 15)
      108, // Luminarch Radiant Lancer (Lv8 2600 ATK + ATK gain, priority 14)
      109, // Luminarch Aurora Seraph (Lv8 2800 ATK + heal + protection, priority 14)

      // ═════════════════════════════════════════════════════════════════════
      // B-TIER SUPPORT & UTILITY — 11 cards
      // ═════════════════════════════════════════════════════════════════════
      107,
      107, // Luminarch Sanctum Protector (Lv7 2800 DEF tank, priority 14)
      106, // Luminarch Magic Sickle (Lv3 recursion engine, priority 12)
      117, // Luminarch Enchanted Halberd (Lv4 SS trigger, priority 11)
      115, // Luminarch Crescent Shield (equip, priority 10)
      13, // Polymerization (fusion para Megashield, priority 10)
      111, // Luminarch Knights Convocation (discard Lv7+ → search Lv4-, priority 9)
      119, // Luminarch Sacred Judgment (comeback, priority 8)
      114, // Luminarch Radiant Wave (removal, priority 8)
      116, // Luminarch Spear of Dawnfall (ATK/DEF zero, priority 7)
      113, // Luminarch Holy Ascension (ATK buff, priority 7)
    ];
  }

  // Sobrescreve buildExtraDeck para usar fusões do arquétipo
  buildExtraDeck() {
    const extraDeckList =
      this.archetype === "shadowheart"
        ? this.getShadowHeartExtraDeck()
        : this.getLuminarchExtraDeck();
    super.buildExtraDeck(extraDeckList);
  }

  // Extra Deck Shadow-Heart
  getShadowHeartExtraDeck() {
    return [
      74, // Shadow-Heart Demon Dragon (fusão principal)
      75, // Shadow-Heart Armored Arctroth (ascensão de Demon Arctroth)
      76, // Shadow-Heart Apocalypse Dragon (ascensão de Scale Dragon)
    ];
  }

  // Extra Deck Luminarch (Fusion + Ascension)
  getLuminarchExtraDeck() {
    return [
      120, // Luminarch Megashield Barbarias (fusion tank, 3000 DEF)
      121, // Luminarch Fortress Aegis (ascensão de Aegisbearer)
    ];
  }

  resolveOpponent(game) {
    if (!game) return null;
    if (typeof game.getOpponent === "function") {
      return game.getOpponent(this);
    }
    return this.id === "player" ? game.bot : game.player;
  }

  async makeMove(game) {
    if (!game || game.gameOver) return;

    try {
      const guard = game.canStartAction({ actor: this, kind: "bot_turn" });
      console.log(`[Bot.makeMove] Guard check:`, guard);
      if (!guard.ok) {
        console.log(`[Bot.makeMove] ❌ Guard blocked: ${guard.reason}`);
        return;
      }

      const phase = game.phase;
      console.log(`[Bot.makeMove] Phase: ${phase}`);

      if (phase === "main1" || phase === "main2") {
        await this.playMainPhase(game);
        if (!game.gameOver && game.phase === phase) {
          const actionDelayMs = Number.isFinite(game?.aiActionDelayMs)
            ? game.aiActionDelayMs
            : 500;
          setTimeout(() => game.nextPhase(), actionDelayMs);
        }
        return;
      }

      if (phase === "battle") {
        this.playBattlePhase(game);
        return;
      }

      if (phase === "end") {
        game.endTurn();
      }
    } catch (error) {
      console.error(
        `[Bot.makeMove] ❌ FATAL ERROR in ${game.phase} phase:`,
        error
      );
      console.error("[Bot.makeMove] Stack trace:", error.stack);
      // Fallback: forçar nextPhase para não travar o jogo
      if (!game.gameOver && typeof game.nextPhase === "function") {
        console.log("[Bot.makeMove] ⚠️ Forcing nextPhase() after error");
        game.nextPhase();
      }
    }
  }

  async playMainPhase(game) {
    // Verificar se o jogo já acabou
    if (game.gameOver) {
      return;
    }

    const bot = this;
    const opponent = game.player.id === bot.id ? game.bot : game.player;

    // === LOG DE ESTADO (DEV MODE) ===
    if (bot.debug) {
      console.log(
        `\n[Bot.playMainPhase] 📊 Estado de ${bot.id} no início da main phase:`
      );
      console.log(
        `  Hand (${bot.hand.length}): ${
          bot.hand.map((c) => c.name).join(", ") || "(vazia)"
        }`
      );
      console.log(
        `  Field (${bot.field.length}): ${
          bot.field
            .map(
              (c) =>
                `${c.name}${
                  c.isFacedown
                    ? "(↓)"
                    : c.position === "attack"
                    ? "(↑ATK)"
                    : "(↑DEF)"
                }`
            )
            .join(", ") || "(vazio)"
        }`
      );
      console.log(
        `  Graveyard (${bot.graveyard.length}): ${
          bot.graveyard.map((c) => c.name).join(", ") || "(vazio)"
        }`
      );
      console.log(`  Field Spell: ${bot.fieldSpell?.name || "(nenhum)"}`);
      console.log(`  LP: ${bot.lp} | Summon Count: ${bot.summonCount}`);
    }

    let chainCount = 0;
    const maxChains = this.maxChainedActions || 2;

    // Flag para usar evaluateBoardV2
    const useV2Evaluation = true;

    while (chainCount < maxChains) {
      // Try Ascension before other actions if available
      const ascended = await this.tryAscensionIfAvailable(game);
      if (ascended) {
        // Allow subsequent actions after ascension
        if (typeof game.waitForPhaseDelay === "function") {
          await game.waitForPhaseDelay();
        }
      }

      const rawActions = this.generateMainPhaseActions(game);
      const actions = this.sequenceActions(rawActions);
      const fallbackActions = this.filterValidActionsForCurrentState(
        actions,
        game
      );

      console.log(
        `[Bot.playMainPhase] Generated ${rawActions.length} raw actions, ${actions.length} sequenced actions`
      );
      if (actions.length > 0) {
        console.log(
          `[Bot.playMainPhase] Actions:`,
          actions.map((a) => `${a.type}:${a.card?.name || a.index}`)
        );
      }

      // 📊 Log de fase vazia
      if (!actions.length) {
        if (botLogger) {
          botLogger.logEmptyPhase(
            this.id,
            game.turnCounter || 0,
            game.phase || "unknown",
            "NO_ACTIONS_GENERATED",
            {
              lp: game.player?.lp,
              handSize: (game.player?.hand || []).length,
              fieldSize: (game.player?.field || []).length,
              gySize: (game.player?.graveyard || []).length,
            }
          );
        }
        break;
      }

      let bestAction = null;

      // DECISÃO: Usar beam search ou greedy?
      // Se tem 2+ opções, usa beam search. Senão, greedy.
      if (actions.length >= 2) {
        // Beam search com parâmetros do Arena (ou defaults)
        const beamWidth = game.arenaBeamWidth ?? 2;
        const maxDepth = game.arenaMaxDepth ?? 2;
        const nodeBudget = game.arenaNodeBudget ?? 100;

        console.log(
          `[Bot.playMainPhase] Running beam search with ${actions.length} actions (width=${beamWidth}, depth=${maxDepth}, budget=${nodeBudget})...`
        );
        const searchResult = await beamSearchTurn(game, this, {
          beamWidth,
          maxDepth,
          nodeBudget,
          useV2Evaluation,
          preGeneratedActions: actions, // BUGFIX: Pass pre-generated actions as fallback
        });

        console.log(`[Bot.playMainPhase] Beam search result:`, searchResult);
        if (searchResult && searchResult.action) {
          bestAction = searchResult.action;
          console.log(`[Bot.playMainPhase] ✅ Beam search chose:`, bestAction);
        } else {
          console.log(`[Bot.playMainPhase] ❌ Beam search returned no action`);
        }
      }

      // Fallback: se beam search não retornou nada, ou só tem 1 opção, usa greedy
      if (!bestAction) {
        console.log(`[Bot.playMainPhase] Running greedy search...`);
        const greedyResult = await greedySearchWithEvalV2(game, this, {
          useV2Evaluation,
          preGeneratedActions: actions, // BUGFIX: Pass pre-generated actions as fallback
        });

        console.log(`[Bot.playMainPhase] Greedy search result:`, greedyResult);
        if (greedyResult && greedyResult.action) {
          bestAction = greedyResult.action;
          console.log(`[Bot.playMainPhase] ✅ Greedy chose:`, bestAction);
        } else {
          console.log(`[Bot.playMainPhase] ❌ Greedy returned no action`);

          // 🔧 EMERGENCY FIX: Se greedy falhou mas temos ações, forçar primeira
          if (!bestAction && actions.length > 0) {
            bestAction =
              fallbackActions.length > 0 ? fallbackActions[0] : actions[0];
            console.warn(
              `[Bot.playMainPhase] 🚨 EMERGENCY FALLBACK: Forcing first action to avoid pass`
            );
          }
        }
      }

      // BUGFIX: Ultimate fallback - Se search falhou mas temos ações, usar a primeira
      if (!bestAction) {
        let finalFallback = fallbackActions;
        if (!finalFallback.length && actions.length > 0) {
          const regenerated = this.sequenceActions(
            this.generateMainPhaseActions(game)
          );
          finalFallback = this.filterValidActionsForCurrentState(
            regenerated,
            game
          );
        }

        if (finalFallback.length > 0) {
          bestAction = finalFallback[0];
          console.log(
            `[Bot.playMainPhase] ?? Using ultimate fallback: first valid action`,
            bestAction
          );
        }
      }

      // Se ainda não tem ação, break
      if (!bestAction) {
        console.log(`[Bot.playMainPhase] ⚠️ No action selected, breaking loop`);
        break;
      }

      // 📊 Log de decisão (ranking e coerência)
      if (botLogger && actions.length > 0) {
        const sorted = [...actions].sort(
          (a, b) => (b.priority || 0) - (a.priority || 0)
        );
        let ranking = -1;
        for (let i = 0; i < sorted.length; i++) {
          if (
            sorted[i].type === bestAction.type &&
            sorted[i].index === bestAction.index
          ) {
            ranking = i;
            break;
          }
        }
        if (ranking >= 0) {
          let coherence = ranking === 0 ? 1.0 : ranking < 3 ? 0.7 : 0.4;
          botLogger.logDecision(
            this.id,
            game.turnCounter || 0,
            game.phase || "unknown",
            actions.length,
            ranking,
            coherence,
            bestAction
          );
        }
      }

      const actionSuccess = await this.executeMainPhaseAction(game, bestAction);
      if (!actionSuccess) {
        if (botLogger?.logEmptyPhase) {
          botLogger.logEmptyPhase(
            this.id,
            game.turnCounter,
            game.phase,
            "ACTION_FAILED",
            {
              lp: this.lp,
              handSize: this.hand.length,
              fieldSize: this.field.length,
              gySize: this.graveyard.length,
            }
          );
        }
        if (typeof game.updateBoard === "function") {
          game.updateBoard();
        }
        break;
      }

      // Incrementar chainCount - todas as ações proativas contam
      chainCount += 1;

      if (typeof game.waitForPhaseDelay === "function") {
        await game.waitForPhaseDelay();
      }
    }

    // Final chance to ascend if no actions left
    await this.tryAscensionIfAvailable(game);
  }

  playBattlePhase(game) {
    const guard = game.canStartAction({
      actor: this,
      kind: "bot_attack",
      phaseReq: "battle",
    });
    if (!guard.ok) {
      console.log(`[Bot.playBattlePhase] ⚠️ Guard blocked:`, guard);
      return;
    }
    console.log(`[Bot.playBattlePhase] ✅ Starting battle phase evaluation`);
    const opponent = this.resolveOpponent(game);
    if (!opponent) return;
    const battleDelayMs = Number.isFinite(game?.aiBattleDelayMs)
      ? game.aiBattleDelayMs
      : 800;
    const minDeltaToAttack = 0.05;

    const performAttack = () => {
      // Verificar se ainda podemos atacar
      if (game.gameOver) return;
      if (game.phase !== "battle") return; // Fase mudou durante resolução

      const availableAttackers = this.field.filter(
        (m) =>
          m &&
          m.cardKind === "monster" &&
          m.position === "attack" &&
          !m.cannotAttackThisTurn &&
          (m.attacksUsedThisTurn || 0) < 1 + (m.extraAttacks || 0)
      );

      if (!availableAttackers.length) {
        setTimeout(() => game.nextPhase(), battleDelayMs);
        return;
      }

      let bestAttack = null;
      let bestDelta = -Infinity;
      let bestAttackerAtk = 0;
      const baseScore = this.evaluateBoard(game, this);
      const opponentLp = opponent.lp || 0;
      const totalAtkPotential = availableAttackers.reduce(
        (sum, m) => sum + (m.atk || 0),
        0
      );

      for (const attacker of availableAttackers) {
        const isSecondAttack = (attacker.attacksUsedThisTurn || 0) >= 1;
        const attackThreshold = isSecondAttack ? 0.0 : minDeltaToAttack;

        const tauntTargets = opponent.field.filter(
          (card) =>
            card &&
            card.cardKind === "monster" &&
            !card.isFacedown &&
            card.mustBeAttacked
        );

        const possibleTargets =
          tauntTargets.length > 0
            ? [...tauntTargets]
            : opponent.field.length
            ? [...opponent.field, null]
            : [null];

        for (const target of possibleTargets) {
          if (target === null && opponent.field.length > 0) continue;

          const simState = this.cloneGameState(game);
          const simAttacker = simState.bot.field.find(
            (c) => c.id === attacker.id
          );
          const simTarget = target
            ? simState.player.field.find((c) => c.id === target.id)
            : null;

          // 🎯 BOOST: Atacar monstros facedown é geralmente vantajoso
          // - DEF estimado = 1500, então ATK >= 1600 provavelmente vence
          // - Remove ameaça desconhecida do campo
          const attackingFacedown = target && target.isFacedown;
          const highAtkAttacker = (attacker.atk || 0) >= 1600;

          if (!simAttacker) continue;

          this.simulateBattle(simState, simAttacker, simTarget);
          const scoreAfter = this.evaluateBoard(simState, simState.bot);
          let delta = scoreAfter - baseScore;
          const opponentLpAfter = simState.player.lp || 0;
          const attackerSurvived = simState.bot.field.some(
            (c) => c.id === attacker.id
          );
          const targetSurvived = target
            ? simState.player.field.some((c) => c.id === target.id)
            : false;
          const lethalNow = opponentLpAfter <= 0;

          if (target === null) delta += 0.5;
          if (target && attackerSurvived) {
            delta += 0.3;
          }
          // 🎯 Bonus para atacar monstros facedown com atacante forte
          // Limpar ameaças desconhecidas é estratégico
          if (attackingFacedown && highAtkAttacker) {
            delta += 0.4; // Incentivar atacar facedowns
            if (!targetSurvived) {
              delta += 0.3; // Bonus extra se conseguiu destruir
            }
          }
          if (target === null && simState.player.field.length === 0) {
            if ((attacker.atk || 0) >= opponentLp) {
              delta += 6;
            } else if (totalAtkPotential >= opponentLp) {
              delta += 3;
            }
          }
          if (lethalNow) {
            delta += 10;
          }
          if (!attackerSurvived && !lethalNow) {
            delta -= targetSurvived ? 1.0 : 0.4;
          }
          if (target && !targetSurvived && attackerSurvived) {
            delta += 0.4;
          }
          if (
            target &&
            simAttacker &&
            simAttacker.cardKind === "monster" &&
            (simAttacker.atk || 0) <= (target.atk || 0)
          ) {
            delta -= 0.5;
          }

          if (
            delta > bestDelta + 0.01 ||
            (Math.abs(delta - bestDelta) <= 0.01 &&
              (attacker.atk || 0) > bestAttackerAtk)
          ) {
            bestDelta = delta;
            bestAttackerAtk = attacker.atk || 0;
            bestAttack = { attacker, target, threshold: attackThreshold };
          }
        }
      }

      const finalThreshold = Math.max(
        bestAttack?.threshold ?? minDeltaToAttack,
        0.05
      );
      if (bestAttack && bestDelta > finalThreshold) {
        // Verificar se atacante ainda está no campo antes de atacar
        const attackerStillOnField = this.field.includes(bestAttack.attacker);
        const targetStillOnField =
          bestAttack.target === null ||
          opponent.field.includes(bestAttack.target);

        if (!attackerStillOnField || !targetStillOnField) {
          // Cartas foram removidas, recalcular na próxima iteração
          setTimeout(() => performAttack(), battleDelayMs);
          return;
        }

        // IMPORTANTE: resolveCombat é async, devemos aguardar antes de verificar gameOver
        Promise.resolve(
          game.resolveCombat(bestAttack.attacker, bestAttack.target)
        )
          .then(() => {
            // Verificar todas as condições antes de continuar atacando
            if (!game.gameOver && game.phase === "battle") {
              setTimeout(() => performAttack(), battleDelayMs);
            }
          })
          .catch((err) => {
            console.error("[Bot.playBattlePhase] resolveCombat error:", err);
          });
      } else {
        setTimeout(() => game.nextPhase(), battleDelayMs);
      }
    };

    performAttack();
  }

  evaluateBoard(gameOrState, perspectivePlayer) {
    return this.strategy.evaluateBoard(gameOrState, perspectivePlayer);
  }

  evaluateBoardV2(gameOrState, perspectivePlayer) {
    return this.strategy.evaluateBoardV2(gameOrState, perspectivePlayer);
  }

  generateMainPhaseActions(game) {
    const actions = this.strategy.generateMainPhaseActions(game);

    // 📊 Log de geração de ações
    if (botLogger) {
      const hand = game.player?.hand || [];
      const field = game.player?.field || [];
      const summonAvailable = (game.player?.summonCount || 0) < 1;
      botLogger.logActionGeneration(
        this.id,
        game.turnCounter || 0,
        game.phase || "unknown",
        hand,
        field,
        summonAvailable,
        actions || []
      );
    }

    return actions;
  }

  sequenceActions(actions) {
    return this.strategy.sequenceActions(actions);
  }

  getTributeRequirementFor(card, playerState) {
    return this.strategy.getTributeRequirementFor(card, playerState);
  }

  // Seleciona os melhores monstros para usar como tributo (os PIORES do campo)
  selectBestTributes(field, tributesNeeded, cardToSummon, context) {
    return this.strategy.selectBestTributes(
      field,
      tributesNeeded,
      cardToSummon,
      context
    );
  }

  simulateMainPhaseAction(state, action) {
    return this.strategy.simulateMainPhaseAction(state, action);
  }

  simulateSpellEffect(state, card) {
    return this.strategy.simulateSpellEffect(state, card);
  }

  simulateBattle(state, attacker, target) {
    if (!attacker) return;
    if (attacker.cannotAttackThisTurn) return;
    if (attacker.position === "defense") return;

    const maxAttacks = 1 + (attacker.extraAttacks || 0);
    const usedAttacks = attacker.attacksUsedThisTurn || 0;

    // Multi-attack mode allows more attacks
    const isMultiAttackMode = attacker.canAttackAllOpponentMonstersThisTurn;
    const multiAttackLimit = attacker.multiAttackLimit || 1;

    if (!isMultiAttackMode && usedAttacks >= maxAttacks) return;
    if (isMultiAttackMode && usedAttacks >= multiAttackLimit) return;

    const attackerOwner = state.bot;
    const defenderOwner = state.player;

    const attackStat = attacker.atk || 0;
    if (!target) {
      defenderOwner.lp -= attackStat;
      attacker.attacksUsedThisTurn = usedAttacks + 1;
      // Multi-attack mode uses different limit
      const effectiveMax = isMultiAttackMode ? multiAttackLimit : maxAttacks;
      attacker.hasAttacked = attacker.attacksUsedThisTurn >= effectiveMax;
      return;
    }

    // 🎭 REGRA: Bot não pode ver DEF de monstros facedown
    // Estimar DEF baseado em média (1500) ao invés de usar valor real
    const targetStat =
      target.position === "attack"
        ? target.atk || 0
        : target.isFacedown
        ? 1500 // Estimativa: DEF médio de monstros
        : target.def || 0;
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
      // BUG #12 FIX: Target in defense position - consider piercing damage
      if (attackStat > targetStat) {
        // Attacker wins - destroy defender
        defenderOwner.graveyard.push(target);
        defenderOwner.field.splice(defenderOwner.field.indexOf(target), 1);
        // Check for piercing damage (inflict excess damage to LP)
        if (attacker.piercing) {
          const piercingDamage = attackStat - targetStat;
          defenderOwner.lp -= piercingDamage;
        }
      } else if (attackStat < targetStat) {
        // Attacker loses - take reflect damage
        attackerOwner.lp -= targetStat - attackStat;
      }
      // If attackStat === targetStat: tie, no damage, no destruction
    }
    attacker.attacksUsedThisTurn = usedAttacks + 1;
    // Multi-attack mode uses different limit
    const effectiveMax = isMultiAttackMode ? multiAttackLimit : maxAttacks;
    attacker.hasAttacked = attacker.attacksUsedThisTurn >= effectiveMax;
  }

  resolveHandIndexForAction(action, expectedKind) {
    if (!action) return -1;
    const hand = this.hand || [];
    const idHint = action.cardId ?? action.card?.id ?? null;
    const nameHint = action.cardName || action.card?.name || null;
    const expectedKinds = Array.isArray(expectedKind)
      ? expectedKind
      : expectedKind
      ? [expectedKind]
      : null;
    const matchesKind = (card) => {
      if (!card) return false;
      if (expectedKinds && !expectedKinds.includes(card.cardKind)) return false;
      return true;
    };
    const matchesById = (card) => {
      if (!matchesKind(card)) return false;
      if (idHint === null || idHint === undefined) return false;
      return card.id === idHint;
    };
    const matchesByName = (card) => {
      if (!matchesKind(card)) return false;
      if (!nameHint) return true;
      return card.name === nameHint;
    };

    if (Number.isInteger(action.index)) {
      const direct = hand[action.index];
      if (matchesById(direct)) return action.index;
      if (
        (idHint === null || idHint === undefined) &&
        !nameHint &&
        matchesKind(direct)
      ) {
        return action.index;
      }
      if (
        (idHint === null || idHint === undefined) &&
        nameHint &&
        matchesByName(direct)
      ) {
        return action.index;
      }
      if (nameHint && matchesByName(direct)) return action.index;
    }

    if (idHint !== null && idHint !== undefined) {
      const foundIndex = hand.findIndex((card) => matchesById(card));
      if (foundIndex >= 0) return foundIndex;
    }

    if (nameHint) {
      const foundIndex = hand.findIndex((card) => matchesByName(card));
      if (foundIndex >= 0) return foundIndex;
    }

    return -1;
  }

  filterValidActionsForCurrentState(actions, game) {
    if (!Array.isArray(actions)) return [];
    return actions.filter((action) => {
      if (!action || !action.type) return false;
      if (action.type === "summon") {
        return this.resolveHandIndexForAction(action, "monster") >= 0;
      }
      if (action.type === "spell") {
        return this.resolveHandIndexForAction(action, "spell") >= 0;
      }
      if (action.type === "set_spell_trap") {
        return this.resolveHandIndexForAction(action, ["spell", "trap"]) >= 0;
      }
      if (action.type === "spellTrapEffect") {
        const zoneIndex = Number.isInteger(action.zoneIndex)
          ? action.zoneIndex
          : action.index;
        const card = this.spellTrap?.[zoneIndex];
        return !!(card && card.cardKind === "spell");
      }
      if (action.type === "special_summon_sanctum_protector") {
        const handIndex = this.resolveHandIndexForAction(action, "monster");
        if (handIndex < 0) return false;
        const materialIndex = Number.isInteger(action.materialIndex)
          ? action.materialIndex
          : this.field.findIndex(
              (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown
            );
        const material = this.field[materialIndex];
        return !!(
          material &&
          material.name === "Luminarch Aegisbearer" &&
          !material.isFacedown
        );
      }
      if (action.type === "handIgnition") {
        return this.resolveHandIndexForAction(action, "monster") >= 0;
      }
      if (action.type === "ascension") {
        const material = this.field[action.materialIndex];
        if (!material) return false;
        if (game?.canUseAsAscensionMaterial) {
          const check = game.canUseAsAscensionMaterial(this, material);
          if (check && check.ok === false) return false;
        }
        return true;
      }
      if (action.type === "fieldEffect") {
        return !!this.fieldSpell;
      }
      return true;
    });
  }

  async executeMainPhaseAction(game, action) {
    if (!action) return false;
    const baseGuard = game.canStartAction({
      actor: this,
      kind: "bot_main_action",
      phaseReq: ["main1", "main2"],
    });
    if (!baseGuard.ok) return false;

    // === ASCENSION SUMMON ===
    if (action.type === "ascension") {
      try {
        const material = this.field[action.materialIndex];
        if (!material) {
          console.log(
            `[Bot.executeMainPhaseAction] ❌ Ascension: material not found at index ${action.materialIndex}`
          );
          return false;
        }

        console.log(
          `[Bot.executeMainPhaseAction] 🔥 Attempting Ascension: ${material.name} → ${action.ascensionCard.name}`
        );

        const result = await game.performAscensionSummon(
          this,
          material,
          action.ascensionCard
        );

        if (result?.success) {
          console.log(
            `[Bot.executeMainPhaseAction] ✅ Ascension successful: ${action.ascensionCard.name}`
          );
          game.updateBoard();
          return true;
        } else {
          console.log(
            `[Bot.executeMainPhaseAction] ❌ Ascension failed:`,
            result?.reason
          );
          return false;
        }
      } catch (e) {
        console.error(
          `[Bot.executeMainPhaseAction] ❌ Ascension error:`,
          e.message
        );
        return false;
      }
    }

    if (action.type === "special_summon_sanctum_protector") {
      const resolvedIndex = this.resolveHandIndexForAction(action, "monster");
      if (resolvedIndex < 0) {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid Sanctum Protector action: no matching card in hand (index=${
            action.index
          }, card=${action.cardName || "unknown"})`
        );
        return false;
      }

      const card = this.hand[resolvedIndex];
      if (!card || card.name !== "Luminarch Sanctum Protector") {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid Sanctum Protector action: card mismatch`
        );
        return false;
      }

      const materialIndex = Number.isInteger(action.materialIndex)
        ? action.materialIndex
        : this.field.findIndex(
            (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown
          );
      const material = this.field[materialIndex];
      if (
        !material ||
        material.name !== "Luminarch Aegisbearer" ||
        material.isFacedown
      ) {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid Sanctum Protector action: no face-up Aegisbearer`
        );
        return false;
      }

      const sendResult = await game.moveCard(material, this, "graveyard", {
        fromZone: "field",
        contextLabel: "sanctum_protector_cost",
      });
      if (sendResult?.success === false) {
        console.log(
          `[Bot.executeMainPhaseAction] Sanctum Protector cost failed:`,
          sendResult?.reason
        );
        return false;
      }

      const position = action.position === "attack" ? "attack" : "defense";
      const summonResult = await game.moveCard(card, this, "field", {
        fromZone: "hand",
        position,
        isFacedown: false,
        resetAttackFlags: true,
        contextLabel: "sanctum_protector_special",
      });
      if (summonResult?.success === false) {
        console.log(
          `[Bot.executeMainPhaseAction] Sanctum Protector summon failed:`,
          summonResult?.reason
        );
        return false;
      }

      if (game && typeof game.emit === "function") {
        await game.emit("after_summon", {
          card,
          player: this,
          method: "special",
          fromZone: "hand",
        });
      }

      game.ui?.log(
        `Bot special summoned ${card.name} by sending ${material.name} to the GY.`
      );
      game.updateBoard();
      return true;
    }

    if (action.type === "summon") {
      const resolvedIndex = this.resolveHandIndexForAction(action, "monster");
      if (resolvedIndex < 0) {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid summon action: no matching monster in hand (index=${
            action.index
          }, card=${action.cardName || "unknown"})`
        );
        return false;
      }
      const cardToSummon = this.hand[resolvedIndex];

      // Calcular tributos necessários e selecionar os melhores (piores monstros)
      const tributeInfo = this.getTributeRequirementFor(cardToSummon, this);
      let tributeIndices = null;

      if (tributeInfo.tributesNeeded > 0) {
        const opponent = this === game.player ? game.bot : game.player;
        tributeIndices = this.selectBestTributes(
          this.field,
          tributeInfo.tributesNeeded,
          cardToSummon,
          { oppField: opponent.field, game }
        );
      }

      const card = this.summon(
        resolvedIndex,
        action.position,
        action.facedown,
        tributeIndices
      );
      if (card) {
        // Emit after_summon event for trigger effects (e.g., Void Mage search)
        // Only trigger if summoned face-up (facedown set doesn't trigger "when Normal Summoned" effects)
        const isFacedownSet = action.facedown === true;
        if (!isFacedownSet && game && typeof game.emit === "function") {
          await game.emit("after_summon", {
            card,
            player: this,
            method: tributeInfo.tributesNeeded > 0 ? "tribute" : "normal",
            fromZone: "hand",
          });
        }

        game.ui?.log(
          `Bot summons ${action.facedown ? "a monster in defense" : card.name}`
        );
        game.updateBoard();
        return true;
      }
      return false;
    }

    if (action.type === "spell") {
      const resolvedIndex = this.resolveHandIndexForAction(action, "spell");
      if (resolvedIndex < 0) {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid spell action: no matching spell in hand (index=${
            action.index
          }, card=${action.cardName || "unknown"})`
        );
        return false;
      }
      const card = this.hand[resolvedIndex];

      console.log(
        `[Bot.executeMainPhaseAction] 📝 Attempting spell: ${card.name}`
      );

      if (
        game.effectEngine &&
        typeof game.effectEngine.canActivateSpellFromHandPreview === "function"
      ) {
        const preview = game.effectEngine.canActivateSpellFromHandPreview(
          card,
          this
        );
        console.log(`[Bot.executeMainPhaseAction] 🔍 Preview check:`, preview);
        if (preview && !preview.ok) {
          console.log(
            `[Bot.executeMainPhaseAction] ❌ Preview rejected:`,
            preview.reason
          );
          return false;
        }
      }

      const activationEffect =
        game.effectEngine?.getSpellTrapActivationEffect?.(card, {
          fromHand: true,
        });

      const pipelineResult = await game.runActivationPipeline({
        card,
        owner: this,
        selectionKind: "spellTrapEffect",
        selectionMessage: "Select target(s) for the spell effect.",
        guardKind: "bot_spell_from_hand",
        phaseReq: ["main1", "main2"],
        preview: () =>
          game.effectEngine?.canActivateSpellFromHandPreview?.(card, this),
        commit: () => game.commitCardActivationFromHand(this, resolvedIndex),
        activationContext: {
          fromHand: true,
          sourceZone: "hand",
        },
        oncePerTurn: {
          card,
          player: this,
          effect: activationEffect,
        },
        activate: (chosen, ctx, zone, resolvedCard) =>
          game.effectEngine.activateSpellTrapEffect(
            resolvedCard,
            this,
            chosen,
            zone,
            ctx
          ),
        finalize: (result, info) => {
          if (result.placementOnly) {
            game.ui?.log?.(`Bot places ${info.card.name}.`);
          } else {
            game.finalizeSpellTrapActivation(
              info.card,
              this,
              info.activationZone
            );
            game.ui?.log?.(`Bot activates ${info.card.name}`);
          }
          game.updateBoard();
        },
      });
      return pipelineResult !== false;
    }

    if (action.type === "set_spell_trap") {
      const resolvedIndex = this.resolveHandIndexForAction(action, [
        "spell",
        "trap",
      ]);
      if (resolvedIndex < 0) {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid set action: no matching card in hand (index=${
            action.index
          }, card=${action.cardName || "unknown"})`
        );
        return false;
      }
      const card = this.hand[resolvedIndex];
      const result = game.setSpellOrTrap(card, resolvedIndex, this);
      if (result && result.ok === false) {
        console.log(
          `[Bot.executeMainPhaseAction] Set spell/trap failed:`,
          result.reason
        );
        return false;
      }
      game.ui?.log?.(`Bot sets a card.`);
      game.updateBoard();
      return true;
    }

    if (action.type === "spellTrapEffect") {
      const zoneIndex = Number.isInteger(action.zoneIndex)
        ? action.zoneIndex
        : action.index;
      const card = this.spellTrap?.[zoneIndex];
      if (!card || card.cardKind !== "spell") {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid spellTrapEffect action: no spell at index ${zoneIndex}`
        );
        return false;
      }

      const activationEffect =
        game.effectEngine?.getSpellTrapActivationEffect?.(card, {
          fromHand: false,
        });

      const activationContext = {
        fromHand: false,
        activationZone: "spellTrap",
        sourceZone: "spellTrap",
      };

      const pipelineResult = await game.runActivationPipeline({
        card,
        owner: this,
        activationZone: "spellTrap",
        activationContext,
        selectionKind: "spellTrapEffect",
        selectionMessage: "Select target(s) for the spell effect.",
        guardKind: "bot_spelltrap_effect",
        phaseReq: ["main1", "main2"],
        preview: () =>
          game.effectEngine?.canActivateSpellTrapEffectPreview?.(
            card,
            this,
            "spellTrap"
          ),
        oncePerTurn: {
          card,
          player: this,
          effect: activationEffect,
        },
        activate: (chosen, ctx, zone) =>
          game.effectEngine.activateSpellTrapEffect(
            card,
            this,
            chosen,
            zone,
            ctx
          ),
        finalize: (result, info) => {
          if (result.placementOnly) {
            game.ui?.log?.(`Bot places ${info.card.name}.`);
          } else {
            game.finalizeSpellTrapActivation(
              info.card,
              this,
              info.activationZone
            );
            game.ui?.log?.(`Bot activates ${info.card.name}`);
          }
          game.updateBoard();
        },
      });

      return !!pipelineResult && pipelineResult.success !== false;
    }

    if (action.type === "fieldEffect" && this.fieldSpell) {
      const activationContext = {
        fromHand: false,
        activationZone: "fieldSpell",
        sourceZone: "fieldSpell",
      };
      const activationEffect =
        game.effectEngine?.getFieldSpellActivationEffect?.(this.fieldSpell);
      await game.runActivationPipeline({
        card: this.fieldSpell,
        owner: this,
        activationZone: "fieldSpell",
        activationContext,
        selectionKind: "fieldSpell",
        selectionMessage: "Select target(s) for the field spell effect.",
        guardKind: "bot_fieldspell_effect",
        phaseReq: ["main1", "main2"],
        oncePerTurn: {
          card: this.fieldSpell,
          player: this,
          effect: activationEffect,
        },
        activate: (selections, ctx) =>
          game.effectEngine.activateFieldSpell(
            this.fieldSpell,
            this,
            selections,
            ctx
          ),
        finalize: () => {
          game.ui?.log?.(`Bot activates ${this.fieldSpell.name}'s effect`);
          game.updateBoard();
        },
      });
      return true;
    }

    // Handler para ativação de efeitos ignition de monstros na mão
    if (action.type === "handIgnition") {
      const resolvedIndex = this.resolveHandIndexForAction(action, "monster");
      if (resolvedIndex < 0) return false;
      const card = this.hand[resolvedIndex];

      console.log(
        `[Bot.executeMainPhaseAction] 🔥 Attempting hand ignition: ${card.name}`
      );

      // Verificar se o efeito pode ser ativado
      const handIgnitionEffect = (card.effects || []).find(
        (e) => e && e.timing === "ignition" && e.requireZone === "hand"
      );
      if (!handIgnitionEffect) {
        console.log(
          `[Bot.executeMainPhaseAction] ❌ No hand ignition effect found`
        );
        return false;
      }

      const activationContext = {
        fromHand: true,
        activationZone: "hand",
        sourceZone: "hand",
      };

      const pipelineResult = await game.runActivationPipeline({
        card,
        owner: this,
        activationZone: "hand",
        activationContext,
        selectionKind: "monsterEffect",
        selectionMessage: "Select target(s) for the monster effect.",
        guardKind: "bot_hand_ignition",
        phaseReq: ["main1", "main2"],
        oncePerTurn: {
          card,
          player: this,
          effect: handIgnitionEffect,
        },
        activate: (chosen, ctx, zone) =>
          game.effectEngine.activateMonsterEffect(
            card,
            this,
            chosen,
            "hand",
            ctx
          ),
        finalize: () => {
          game.ui?.log?.(`Bot activates ${card.name}'s effect from hand`);
          game.updateBoard();
        },
      });
      return pipelineResult !== false;
    }

    return false;
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
    const opponent = this.resolveOpponent(game) || game.player;

    return {
      player: clonePlayer(opponent),
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

  async tryAscensionIfAvailable(game) {
    try {
      // Find a material on bot field eligible for ascension
      const materials = (this.field || []).filter(
        (m) => m && m.cardKind === "monster" && !m.isFacedown
      );
      for (const material of materials) {
        const matCheck = game.canUseAsAscensionMaterial(this, material);
        if (!matCheck.ok) continue;
        const candidates =
          game.getAscensionCandidatesForMaterial(this, material) || [];
        if (!candidates.length) continue;
        // Filter by requirements
        const eligible = candidates.filter(
          (asc) => game.checkAscensionRequirements(this, asc).ok
        );
        if (!eligible.length) continue;

        // Priorização inteligente de Ascensão
        const best = this.selectBestAscension(eligible, material, game);
        const res = await game.performAscensionSummon(this, material, best);
        if (res?.success) {
          return true;
        }
      }
    } catch (e) {
      // Silent fail; bot ascension is opportunistic
    }
    return false;
  }

  /**
   * Seleciona a melhor Ascensão baseada no contexto do jogo.
   * @param {Array} eligible - Lista de ascensões elegíveis
   * @param {Object} material - Monstro material
   * @param {Object} game - Instância do jogo
   * @returns {Object} Melhor ascensão
   */
  selectBestAscension(eligible, material, game) {
    if (eligible.length === 1) return eligible[0];

    const opponent = this.resolveOpponent(game);
    const oppField = opponent?.field || [];
    const oppHasThreats = oppField.some((m) => (m?.atk || 0) >= 2000);
    const oppFieldSize = oppField.length;

    // Calcular score para cada ascensão
    const scored = eligible.map((asc) => {
      let score = 0;

      // Base: ATK
      score += (asc.atk || 0) / 100;

      // Shadow-Heart Armored Arctroth (75): melhor contra ameaças únicas fortes
      if (asc.id === 75 && oppHasThreats) {
        score += 5; // Efeito de zerar ATK/DEF é ótimo contra bosses
      }

      // Shadow-Heart Apocalypse Dragon (76): melhor para pressão/remoção contínua
      if (asc.id === 76) {
        score += 3; // Remoção 1x/turno é sempre útil
        if (oppFieldSize >= 2) {
          score += 2; // Board wipe ao sair = seguro contra swarm
        }
      }

      // Priorizar ATK maior se não há contexto específico
      if (!oppHasThreats && oppFieldSize === 0) {
        score += (asc.atk || 0) / 200; // Peso extra para ATK se campo vazio
      }

      return { asc, score };
    });

    // Ordenar por score decrescente e retornar o melhor
    scored.sort((a, b) => b.score - a.score);
    return scored[0].asc;
  }
}
