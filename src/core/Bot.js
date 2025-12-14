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
    this.archetype = archetype;

    // Seleciona estratégia baseado no arquétipo
    if (archetype === "shadowheart") {
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
      34,
      34,
      34, // Shadow-Heart Imp (extender - 3x)
      35, // Shadow-Heart Gecko (draw engine - 1x)
      11,
      11, // Shadow-Heart Specter (recursão GY - 2x)
      36,
      36, // Shadow-Heart Coward (discard value - 2x)
      3,
      3, // Shadow-Heart Observer (special summon - 2x)
      7,
      7, // Shadow-Heart Abyssal Eel (utility - 2x)
      66, // Shadow-Heart Leviathan (burn beater - 1x)
      45, // Shadow-Heart Death Wyrm (hand trap boss - 1x)
      // Bosses
      38,
      38, // Shadow-Heart Scale Dragon (boss 3000 ATK - 2x)
      31, // Shadow-Heart Demon Arctroth (boss com remoção - 1x)
      41,
      41, // Shadow-Heart Griffin (sem tributo - 2x)
      // === SPELLS ===
      100,
      100, // Polymerization (fusão - 2x)
      42,
      42, // Darkness Valley (field spell - 2x)
      37,
      37, // Shadow-Heart Infusion (revive - 2x)
      33,
      33, // Shadow-Heart Covenant (searcher - 2x)
      32, // Shadow-Heart Battle Hymn (buff - 1x)
      39, // Shadow-Heart Rage (OTK enabler - 1x)
      15, // Shadow-Heart Purge (remoção - 1x)
      40, // Shadow-Heart Shield (proteção - 1x)
    ];
  }

  // Deck Luminarch fixo e balanceado
  getLuminarchDeck() {
    return [
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
      101, // Shadow-Heart Demon Dragon (fusão principal)
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
      let bestDelta = 0;
      const baseScore = this.evaluateBoard(game, this);

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

          if (delta > bestDelta) {
            bestDelta = delta;
            bestAttack = { attacker, target, threshold: attackThreshold };
          }
        }
      }

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
      const selections = this.buildAutoSelections(card, game);
      const commit = game.commitCardActivationFromHand(this, action.index);
      if (!commit || !commit.cardRef) return;
      const { cardRef, activationZone } = commit;

      let result = await game.effectEngine.activateSpellTrapEffect(
        cardRef,
        this,
        selections,
        activationZone
      );

      if (result && result.needsSelection && result.options) {
        const auto = this.convertOptionsToSelection(result.options);
        if (auto) {
          result = await game.effectEngine.activateSpellTrapEffect(
            cardRef,
            this,
            auto,
            activationZone
          );
        }
      }
      if (!result?.success) {
        console.log("Bot failed to activate spell:", result?.reason);
      } else {
        game.renderer.log(`Bot activates ${cardRef.name}`);
        game.updateBoard();
        game.finalizeSpellTrapActivation(cardRef, this, activationZone);
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
        card.name === "Shadow-Heart Coat" ||
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
        const citadelBonus =
          this.fieldSpell?.name === "Sanctum of the Luminarch Citadel"
            ? 200
            : 0;
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
            (item) =>
              hasLuminarchArchetype(item.card) &&
              item.card.cardKind === "monster"
          )
          .sort((a, b) => b.atk - a.atk)
          .slice(0, maxSummons);

        if (luminarchCandidates.length > 0) {
          console.log(
            `[Sacred Judgment] Summoning ${
              luminarchCandidates.length
            } monsters: ${luminarchCandidates
              .map((c) => c.card.name)
              .join(", ")}`
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
            `[Convocation] Discarding ${
              discardCard.name
            } (value ${evaluateCardValue(discardCard)}) to search.`
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
