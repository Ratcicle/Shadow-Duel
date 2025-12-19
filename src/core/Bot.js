import Player from "./Player.js";
import { cardDatabase, cardDatabaseById } from "../data/cards.js";
import Card from "./Card.js";
import LuminarchStrategy from "./ai/LuminarchStrategy.js";
import ShadowHeartStrategy from "./ai/ShadowHeartStrategy.js";

export default class Bot extends Player {
  constructor(archetype = "shadowheart") {
    super("bot", "Opponent");
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

    if (this.archetype === "shadowheart") {
      this.strategy = new ShadowHeartStrategy(this);
    } else {
      this.strategy = new LuminarchStrategy(this);
    }
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
      51,
      51, // Shadow-Heart Observer (special summon - 2x)
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

  async makeMove(game) {
    if (!game || game.gameOver) return;

    const phase = game.phase;

    if (phase === "main1" || phase === "main2") {
      await this.playMainPhase(game);
      if (!game.gameOver && game.phase === phase) {
        setTimeout(() => game.nextPhase(), 500);
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
    let chainCount = 0;
    const maxChains = this.maxChainedActions || 2;

    while (chainCount < maxChains) {
      const actions = this.sequenceActions(this.generateMainPhaseActions(game));
      if (!actions.length) break;

      const baseScore = this.evaluateBoard(game, this);
      let bestAction = null;
      let bestScore = baseScore;

      for (const action of actions) {
        const simState = this.cloneGameState(game);
        this.simulateMainPhaseAction(simState, action);
        const score = this.evaluateBoard(simState, simState.bot);
        if (score > bestScore + 0.001) {
          bestScore = score;
          bestAction = action;
        }
      }

      if (!bestAction) break;

      await this.executeMainPhaseAction(game, bestAction);
      chainCount += 1;

      if (typeof game.waitForPhaseDelay === "function") {
        await game.waitForPhaseDelay();
      }
    }
  }

  playBattlePhase(game) {
    const minDeltaToAttack = 0.05;

    const performAttack = () => {
      if (game.gameOver) return;

      const availableAttackers = this.field.filter(
        (m) =>
          m &&
          m.cardKind === "monster" &&
          m.position === "attack" &&
          !m.cannotAttackThisTurn &&
          (m.attacksUsedThisTurn || 0) < 1 + (m.extraAttacks || 0)
      );

      if (!availableAttackers.length) {
        setTimeout(() => game.nextPhase(), 800);
        return;
      }

      let bestAttack = null;
      let bestDelta = -Infinity;
      let bestAttackerAtk = 0;
      const baseScore = this.evaluateBoard(game, this);
      const opponentLp = game.player.lp || 0;
      const totalAtkPotential = availableAttackers.reduce(
        (sum, m) => sum + (m.atk || 0),
        0
      );

      for (const attacker of availableAttackers) {
        const isSecondAttack = (attacker.attacksUsedThisTurn || 0) >= 1;
        const attackThreshold = isSecondAttack ? 0.0 : minDeltaToAttack;

        const tauntTargets = game.player.field.filter(
          (card) =>
            card &&
            card.cardKind === "monster" &&
            !card.isFacedown &&
            card.mustBeAttacked
        );

        const possibleTargets =
          tauntTargets.length > 0
            ? [...tauntTargets]
            : game.player.field.length
            ? [...game.player.field, null]
            : [null];

        for (const target of possibleTargets) {
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

          if (target === null) delta += 0.5;
          if (target && simState.bot.field.find((c) => c.id === attacker.id)) {
            delta += 0.3;
          }
          if (target === null && simState.player.field.length === 0) {
            if ((attacker.atk || 0) >= opponentLp) {
              delta += 6;
            } else if (totalAtkPotential >= opponentLp) {
              delta += 3;
            }
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
    return this.strategy.evaluateBoard(gameOrState, perspectivePlayer);
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

  async executeMainPhaseAction(game, action) {
    if (!action) return;

    if (action.type === "summon") {
      const cardToSummon = this.hand[action.index];
      if (!cardToSummon) return;

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
      if (game.phase !== "main1" && game.phase !== "main2") return;

      if (
        game.effectEngine &&
        typeof game.effectEngine.canActivateSpellFromHandPreview === "function"
      ) {
        const preview = game.effectEngine.canActivateSpellFromHandPreview(
          card,
          this
        );
        if (preview && !preview.ok) {
          return;
        }
      }

      await game.runActivationPipeline({
        card,
        owner: this,
        selectionKind: "spellTrapEffect",
        selectionMessage: "Select target(s) for the spell effect.",
        gate: () => {
          if (game.turn !== "bot") return { ok: false };
          if (game.isResolvingEffect) {
            return {
              ok: false,
              reason: "Finish the current effect before activating another card.",
            };
          }
          return { ok: true };
        },
        preview: () =>
          game.effectEngine?.canActivateSpellFromHandPreview?.(card, this),
        commit: () => game.commitCardActivationFromHand(this, action.index),
        activationContext: {
          fromHand: true,
          sourceZone: "hand",
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
            game.renderer?.log?.(`Bot places ${info.card.name}.`);
          } else {
            game.finalizeSpellTrapActivation(
              info.card,
              this,
              info.activationZone
            );
            game.renderer?.log?.(`Bot activates ${info.card.name}`);
          }
          game.updateBoard();
        },
      });
      return;
    }

    if (action.type === "fieldEffect" && this.fieldSpell) {
      const activationContext = {
        fromHand: false,
        activationZone: "fieldSpell",
        sourceZone: "fieldSpell",
      };
      await game.runActivationPipeline({
        card: this.fieldSpell,
        owner: this,
        activationZone: "fieldSpell",
        activationContext,
        selectionKind: "fieldSpell",
        selectionMessage: "Select target(s) for the field spell effect.",
        activate: (selections, ctx) =>
          game.effectEngine.activateFieldSpell(
            this.fieldSpell,
            this,
            selections,
            ctx
          ),
        finalize: () => {
          game.renderer?.log?.(`Bot activates ${this.fieldSpell.name}'s effect`);
          game.updateBoard();
        },
      });
    }
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

