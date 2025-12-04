import Player from "./Player.js";

export default class Bot extends Player {
  constructor() {
    super("bot", "Opponent");
    this.maxSimulationsPerPhase = 20;
    this.maxChainedActions = 2;
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
    const baseScore = this.evaluateBoard(game, this);
    let bestAttack = null;
    let bestDelta = -Infinity;

    for (const attacker of this.field) {
      if (
        attacker.position !== "attack" ||
        attacker.hasAttacked ||
        attacker.cannotAttackThisTurn
      ) {
        continue;
      }

      const possibleTargets = game.player.field.length
        ? [...game.player.field]
        : [null];

      for (const target of possibleTargets) {
        const simState = this.cloneGameState(game);
        const simAttacker = simState.bot.field.find(
          (c) => c.id === attacker.id
        );
        const simTarget = target
          ? simState.player.field.find((c) => c.id === target.id)
          : null;

        this.simulateBattle(simState, simAttacker, simTarget);
        const newScore = this.evaluateBoard(simState, simState.bot);
        const delta = newScore - baseScore;

        if (delta > bestDelta) {
          bestDelta = delta;
          bestAttack = { attacker, target };
        }
      }
    }

    if (bestAttack && bestDelta > -Infinity) {
      game.resolveCombat(bestAttack.attacker, bestAttack.target);
    }

    setTimeout(() => game.nextPhase(), 800);
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

    // Life points
    score += (perspective.lp - opponent.lp) / 500;

    // Monster presence
    const monsterValue = (monster) => {
      const atk = (monster.atk || 0) + (monster.tempAtkBoost || 0);
      const def = (monster.def || 0) + (monster.tempDefBoost || 0);
      const base = monster.position === "defense" ? def : atk;
      let value = base / 1000 + (monster.level || 0) * 0.15;
      if (monster.cannotAttackThisTurn) value -= 0.2;
      if (monster.hasAttacked) value -= 0.05;

      if (perspective.fieldSpell && perspective.fieldSpell.name) {
        if (
          perspective.fieldSpell.name === "Darkness Valley" &&
          monster.archetypes?.includes("Shadow-Heart")
        ) {
          value += 0.3;
        }
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

    // Spells and field
    if (perspective.fieldSpell) {
      score += 1.2;
      if (perspective.fieldSpell.name === "Darkness Valley") {
        score += 0.5;
      }
    }
    score -= opponent.fieldSpell ? 0.8 : 0;

    // Equips on field
    score += perspective.spellTrap.length * 0.2;
    score -= opponent.spellTrap.length * 0.15;

    // Hand advantage
    score += (perspective.hand.length - opponent.hand.length) * 0.3;

    // Graveyard synergies
    const hasReviver = perspective.hand.some((c) =>
      ["Monster Reborn", "Shadow-Heart Infusion"].includes(c.name)
    );
    if (hasReviver) {
      const bestGY = perspective.graveyard.reduce(
        (max, c) =>
          c.cardKind === "monster" ? Math.max(max, c.atk || 0) : max,
        0
      );
      score += bestGY / 2000;
    }

    const hasInvocation = perspective.hand.some(
      (c) => c.name === "Shadow-Heart Invocation"
    );
    const hasScaleDragon =
      perspective.hand.some((c) => c.name === "Shadow-Heart Scale Dragon") ||
      perspective.graveyard.some((c) => c.name === "Shadow-Heart Scale Dragon");
    if (hasInvocation && hasScaleDragon) {
      score += 1.5;
    }

    return score;
  }

  generateMainPhaseActions(game) {
    const actions = [];

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

    // Spells
    this.hand.forEach((card, index) => {
      if (card.cardKind !== "spell") return;
      const check = game.effectEngine.canActivate(card, this);
      if (!check.ok) return;

      // Extra heuristics
      if (card.name === "Shadow-Heart Infusion") {
        const gyHasSH = this.graveyard.some((c) =>
          c.archetypes?.includes("Shadow-Heart")
        );
        if (this.hand.length < 3 || !gyHasSH) return;
      }
      if (card.name === "Shadow-Heart Invocation") {
        const hasScale =
          this.hand.some((c) => c.name === "Shadow-Heart Scale Dragon") ||
          this.graveyard.some((c) => c.name === "Shadow-Heart Scale Dragon");
        const uniqueSH = new Set(
          this.field
            .filter((c) => c.archetypes?.includes("Shadow-Heart"))
            .map((c) => c.name)
        );
        if (!hasScale || uniqueSH.size < 3) return;
      }
      if (card.subtype === "field" && this.fieldSpell) {
        // Prefer not replacing unless field is missing
        if (this.fieldSpell.name === card.name) return;
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

    return actions;
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

  simulateMainPhaseAction(state, action) {
    if (!action) return state;

    switch (action.type) {
      case "summon": {
        const player = state.bot;
        const card = player.hand[action.index];
        if (!card) break;
        const tributeInfo = this.getTributeRequirementFor(card, player);
        const tributesNeeded = tributeInfo.tributesNeeded;
        const tributeIndices = [];
        for (let i = 0; i < tributesNeeded; i++) {
          tributeIndices.push(i);
        }

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
      default:
        break;
    }
  }

  simulateBattle(state, attacker, target) {
    if (!attacker) return;
    if (attacker.cannotAttackThisTurn) return;

    const attackerOwner = state.bot;
    const defenderOwner = state.player;

    const attackStat = attacker.atk || 0;
    if (!target) {
      defenderOwner.lp -= attackStat;
      attacker.hasAttacked = true;
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
    attacker.hasAttacked = true;
  }

  executeMainPhaseAction(game, action) {
    if (!action) return;

    if (action.type === "summon") {
      const card = this.summon(action.index, action.position, action.facedown);
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
        card.name === "Shadow Coat"
      ) {
        let bestIdx = 0;
        let bestAtk = -Infinity;
        candidates.candidates.forEach((c, idx) => {
          if (c.atk > bestAtk) {
            bestAtk = c.atk;
            bestIdx = idx;
          }
        });
        chosen = [bestIdx];
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
      if (!opt.def || !Array.isArray(opt.candidates)) continue;
      selections[opt.def.id] = [0];
    }
    return selections;
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
    };
  }
}
