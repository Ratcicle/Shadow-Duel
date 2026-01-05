import Player from "./Player.js";
import { cardDatabase, cardDatabaseById } from "../data/cards.js";
import Card from "./Card.js";
import { getStrategyFor } from "./ai/StrategyRegistry.js";
import { beamSearchTurn, greedySearchWithEvalV2 } from "./ai/BeamSearch.js";

export default class Bot extends Player {
  constructor(archetype = "shadowheart") {
    super("bot", "Opponent", "ai");
    this.maxSimulationsPerPhase = 20;
    this.maxChainedActions = 3;
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
    ];
  }

  // Deck Luminarch fixo e balanceado
  getLuminarchDeck() {
    return [
      // Monstros principais (nível baixo - searchers/utility)
      101,
      101,
      101, // Luminarch Valiant – Knight of the Dawn (searcher)
      103,
      103,
      103, // Luminarch Aegisbearer (taunt/tank)
      110,
      110, // Luminarch Sanctified Arbiter (busca Convocation)
      106,
      106, // Luminarch Magic Sickle (baixo nível)
      117,
      117, // Luminarch Enchanted Halberd
      // Monstros médios/altos (bosses)
      104,
      104, // Luminarch Moonblade Captain (revive + double attack)
      105,
      105, // Luminarch Celestial Marshal (boss lv7)
      108, // Luminarch Radiant Lancer (boss lv8)
      109, // Luminarch Aurora Seraph (boss lv8)
      107, // Luminarch Sanctum Protector (lv7 defesa)
      // Magias
      111,
      111, // Luminarch Knights Convocation
      112,
      112, // Sanctum of the Luminarch Citadel (field spell)
      118,
      118, // Luminarch Moonlit Blessing (recovery)
      102,
      102, // Luminarch Holy Shield (proteção)
      115, // Luminarch Crescent Shield (equip)
      119, // Luminarch Sacred Judgment (comeback)
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
    ];
  }

  // Extra Deck Luminarch (placeholder para futuras fusões)
  getLuminarchExtraDeck() {
    return [];
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
    const guard = game.canStartAction({ actor: this, kind: "bot_turn" });
    if (!guard.ok) return;

    const phase = game.phase;

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
  }

  async playMainPhase(game) {
    // Verificar se o jogo já acabou
    if (game.gameOver) {
      return;
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
      if (!actions.length) break;

      let bestAction = null;

      // DECISÃO: Usar beam search ou greedy?
      // Se tem 2+ opções, usa beam search. Senão, greedy.
      if (actions.length >= 2) {
        // Beam search: lookahead 2 plies
        const searchResult = await beamSearchTurn(game, this, {
          beamWidth: 2,
          maxDepth: 2,
          nodeBudget: 100,
          useV2Evaluation,
        });

        if (searchResult && searchResult.action) {
          bestAction = searchResult.action;
        }
      }

      // Fallback: se beam search não retornou nada, ou só tem 1 opção, usa greedy
      if (!bestAction) {
        const greedyResult = await greedySearchWithEvalV2(game, this, {
          useV2Evaluation,
        });

        if (greedyResult && greedyResult.action) {
          bestAction = greedyResult.action;
        }
      }

      // Se ainda não tem ação, break
      if (!bestAction) break;

      await this.executeMainPhaseAction(game, bestAction);
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
    if (!guard.ok) return;
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
        const targetStillOnField = bestAttack.target === null || opponent.field.includes(bestAttack.target);
        
        if (!attackerStillOnField || !targetStillOnField) {
          // Cartas foram removidas, recalcular na próxima iteração
          setTimeout(() => performAttack(), battleDelayMs);
          return;
        }

        // IMPORTANTE: resolveCombat é async, devemos aguardar antes de verificar gameOver
        Promise.resolve(game.resolveCombat(bestAttack.attacker, bestAttack.target))
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
    return this.strategy.generateMainPhaseActions(game);
  }

  sequenceActions(actions) {
    return this.strategy.sequenceActions(actions);
  }

  getTributeRequirementFor(card, playerState) {
    return this.strategy.getTributeRequirementFor(card, playerState);
  }

  // Seleciona os melhores monstros para usar como tributo (os PIORES do campo)
  selectBestTributes(field, tributesNeeded, cardToSummon) {
    return this.strategy.selectBestTributes(
      field,
      tributesNeeded,
      cardToSummon
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

  async executeMainPhaseAction(game, action) {
    if (!action) return false;
    const baseGuard = game.canStartAction({
      actor: this,
      kind: "bot_main_action",
      phaseReq: ["main1", "main2"],
    });
    if (!baseGuard.ok) return false;

    if (action.type === "summon") {
      const cardToSummon = this.hand[action.index];
      if (!cardToSummon) return false;

      // Calcular tributos necessários e selecionar os melhores (piores monstros)
      const tributeInfo = this.getTributeRequirementFor(cardToSummon, this);
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
        game.ui?.log(
          `Bot summons ${action.facedown ? "a monster in defense" : card.name}`
        );
        game.updateBoard();
        return true;
      }
      return false;
    }

    if (action.type === "spell") {
      const card = this.hand[action.index];
      if (!card) return false;

      if (
        game.effectEngine &&
        typeof game.effectEngine.canActivateSpellFromHandPreview === "function"
      ) {
        const preview = game.effectEngine.canActivateSpellFromHandPreview(
          card,
          this
        );
        if (preview && !preview.ok) {
          return false;
        }
      }

      const activationEffect =
        game.effectEngine?.getSpellTrapActivationEffect?.(card, {
          fromHand: true,
        });

      await game.runActivationPipeline({
        card,
        owner: this,
        selectionKind: "spellTrapEffect",
        selectionMessage: "Select target(s) for the spell effect.",
        guardKind: "bot_spell_from_hand",
        phaseReq: ["main1", "main2"],
        preview: () =>
          game.effectEngine?.canActivateSpellFromHandPreview?.(card, this),
        commit: () => game.commitCardActivationFromHand(this, action.index),
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
      return true;
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
        // Pick highest ATK ascension monster
        const best = eligible
          .slice()
          .sort((a, b) => (b.atk || 0) - (a.atk || 0))[0];
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
}
