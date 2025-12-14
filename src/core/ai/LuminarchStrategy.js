import BaseStrategy from "./BaseStrategy.js";
import { cardDatabase } from "../../data/cards.js";

export default class LuminarchStrategy extends BaseStrategy {
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

    // LP delta (low weight)
    score += (perspective.lp - opponent.lp) / 800;

    const isLuminarch = (card) => {
      if (!card) return false;
      const archetypes = Array.isArray(card.archetypes)
        ? card.archetypes
        : card.archetype
        ? [card.archetype]
        : [];
      return archetypes.includes("Luminarch");
    };

    const monsterValue = (monster) => {
      const atk = (monster.atk || 0) + (monster.tempAtkBoost || 0);
      const def = (monster.def || 0) + (monster.tempDefBoost || 0);
      const base = monster.position === "defense" ? def : atk;
      let value = base / 1000 + (monster.level || 0) * 0.15;
      if (monster.cannotAttackThisTurn) value -= 0.2;
      if (monster.hasAttacked) value -= 0.05;

      if (
        perspective.fieldSpell &&
        perspective.fieldSpell.name === "Sanctum of the Luminarch Citadel"
      ) {
        if (isLuminarch(monster)) value += 0.4;
      }

      if (
        monster.name === "Luminarch Aegisbearer" ||
        monster.name === "Luminarch Sanctum Protector"
      ) {
        value += 0.5;
      }
      if (monster.name === "Luminarch Aurora Seraph") value += 1.2;
      if (monster.name === "Luminarch Celestial Marshal") value += 0.8;
      if (monster.name === "Luminarch Radiant Lancer") value += 1.0;
      if (monster.name === "Luminarch Moonblade Captain") value += 0.6;
      if (monster.mustBeAttacked) value += 0.3;

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

    const vulnerablePenalty = perspective.field.reduce((penalty, card) => {
      if (card.position !== "attack") return penalty;
      const canBeDestroyed = opponent.field.some(
        (oppCard) =>
          oppCard &&
          oppCard.position === "attack" &&
          (oppCard.atk || 0) > (card.atk || 0)
      );
      if (canBeDestroyed) penalty -= (card.atk || 0) / 2000;
      return penalty;
    }, 0);
    score += vulnerablePenalty;

    if (perspective.fieldSpell) {
      score += 1.2;
      if (perspective.fieldSpell.name === "Sanctum of the Luminarch Citadel") {
        score += 0.8;
      }
    }
    score -= opponent.fieldSpell ? 0.8 : 0;

    score += perspective.spellTrap.length * 0.25;
    score -= opponent.spellTrap.length * 0.15;

    const hasHolyShieldActive = perspective.spellTrap.some(
      (c) => c.name === "Luminarch Holy Shield"
    );
    if (hasHolyShieldActive) score += 0.5;

    score += (perspective.hand.length - opponent.hand.length) * 0.3;

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

    const hasConvocation = perspective.hand.some(
      (c) => c.name === "Luminarch Knights Convocation"
    );
    const hasHighLevelInGY = perspective.graveyard.some(
      (c) => isLuminarch(c) && c.cardKind === "monster" && (c.level || 0) >= 7
    );
    if (hasConvocation && hasHighLevelInGY) score += 0.7;

    if (perspective.lp < 2000) {
      const oppHasSacredJudgment = opponent.hand.some(
        (c) => c.name === "Luminarch Sacred Judgment"
      );
      if (oppHasSacredJudgment) score -= 0.5;
    }

    const playableCards = perspective.hand.filter((c) => {
      if (c.cardKind === "monster") {
        const tributes = this.getTributeRequirementFor(c, perspective);
        return perspective.field.length >= tributes.tributesNeeded;
      }
      return c.cardKind === "spell";
    });
    if (playableCards.length >= 3) score += 0.4;

    const oppTauntCount = opponent.field.filter(
      (m) => m && m.mustBeAttacked
    ).length;
    if (oppTauntCount > 0) score -= oppTauntCount * 0.2;

    return score;
  }

  generateMainPhaseActions(game) {
    const actions = [];
    const bot = this.bot;

    bot.hand.forEach((card, index) => {
      if (card.cardKind !== "monster") return;
      if (bot.summonCount >= 1) return;
      const tributeInfo = this.getTributeRequirementFor(card, bot);
      if (bot.field.length < tributeInfo.tributesNeeded) return;

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

    const hasLuminarchArchetype = (c) => {
      const archetypes = Array.isArray(c.archetypes)
        ? c.archetypes
        : c.archetype
        ? [c.archetype]
        : [];
      return archetypes.includes("Luminarch");
    };

    bot.hand.forEach((card, index) => {
      if (card.cardKind !== "spell") return;
      const check = game.effectEngine.canActivate(card, bot);
      if (!check.ok) return;

      if (card.name === "Luminarch Holy Shield") {
        const luminarchOnField = bot.field.filter(hasLuminarchArchetype);
        if (luminarchOnField.length === 0) return;
      }
      if (card.name === "Luminarch Moonlit Blessing") {
        const gyHasLuminarch = bot.graveyard.some(
          (c) => hasLuminarchArchetype(c) && c.cardKind === "monster"
        );
        if (!gyHasLuminarch) return;
      }
      if (card.name === "Luminarch Sacred Judgment") {
        if (bot.field.length > 0) return;
        if (game.player.field.length < 2) return;
        const gyHasLuminarch = bot.graveyard.some(
          (c) => hasLuminarchArchetype(c) && c.cardKind === "monster"
        );
        if (!gyHasLuminarch) return;
        if (bot.lp < 2000) return;
      }
      if (card.name === "Luminarch Knights Convocation") {
        const hasHighLevel = bot.hand.some((c) => {
          if (c === card) return false;
          return (
            hasLuminarchArchetype(c) &&
            c.cardKind === "monster" &&
            (c.level || 0) >= 7
          );
        });
        if (!hasHighLevel) return;

        const hasBossInDeck = cardDatabase.some(
          (c) =>
            hasLuminarchArchetype(c) &&
            (c.name.includes("Marshal") ||
              c.name.includes("Lancer") ||
              c.name.includes("Seraph"))
        );
        if (
          !hasBossInDeck &&
          !bot.graveyard.some(
            (c) =>
              hasLuminarchArchetype(c) &&
              c.cardKind === "monster" &&
              (c.name.includes("Arbiter") ||
                c.name.includes("Enchanted") ||
                c.name === "Luminarch Moonlit Blessing")
          )
        ) {
          return;
        }
      }
      if (card.subtype === "field") {
        if (bot.fieldSpell) {
          if (bot.fieldSpell.name === card.name) return;
        }
        if (card.name === "Sanctum of the Luminarch Citadel") {
          const luminarchOnField = bot.field.filter(hasLuminarchArchetype);
          if (
            luminarchOnField.length === 0 &&
            !bot.hand.some(
              (c) =>
                c.cardKind === "monster" &&
                hasLuminarchArchetype(c) &&
                this.getTributeRequirementFor(c, bot).tributesNeeded <=
                  bot.field.length
            )
          ) {
            return;
          }
        }
      }

      actions.push({ type: "spell", index });
    });

    if (bot.fieldSpell) {
      const effect = (bot.fieldSpell.effects || []).find(
        (e) => e.timing === "on_field_activate"
      );
      if (effect) {
        const optCheck = game.effectEngine.checkOncePerTurn(
          bot.fieldSpell,
          bot,
          effect
        );
        if (optCheck.ok) {
          actions.push({ type: "fieldEffect" });
        }
      }
    }

    return this.sequenceActions(actions);
  }

  sequenceActions(actions) {
    const bot = this.bot;
    const summons = actions.filter((a) => a.type === "summon");
    const spells = actions.filter((a) => a.type === "spell");
    const fieldEffects = actions.filter((a) => a.type === "fieldEffect");

    const getSpellName = (index) => bot.hand[index]?.name || "";

    const spellPriority = {
      "Sanctum of the Luminarch Citadel": 10,
      "Luminarch Sacred Judgment": 9,
      "Luminarch Moonlit Blessing": 8,
      "Luminarch Holy Shield": 7,
      "Luminarch Knights Convocation": 6,
      "Luminarch Holy Ascension": 5,
      "Luminarch Crescent Shield": 4,
    };

    spells.sort((a, b) => {
      const nameA = getSpellName(a.index);
      const nameB = getSpellName(b.index);
      const priorityA = spellPriority[nameA] ?? 0;
      const priorityB = spellPriority[nameB] ?? 0;
      return priorityB - priorityA;
    });

    const reordered = [];
    reordered.push(
      ...spells.filter(
        (a) => getSpellName(a.index) === "Sanctum of the Luminarch Citadel"
      )
    );
    reordered.push(
      ...spells.filter(
        (a) => getSpellName(a.index) === "Luminarch Sacred Judgment"
      )
    );
    reordered.push(
      ...spells.filter((a) =>
        ["Luminarch Holy Shield", "Luminarch Crescent Shield"].includes(
          getSpellName(a.index)
        )
      )
    );
    reordered.push(
      ...spells.filter(
        (a) => getSpellName(a.index) === "Luminarch Knights Convocation"
      )
    );
    reordered.push(
      ...spells.filter(
        (a) => getSpellName(a.index) === "Luminarch Moonlit Blessing"
      )
    );
    reordered.push(...spells.filter((a) => !reordered.includes(a)));
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

  selectBestTributes(field, tributesNeeded, cardToSummon) {
    if (tributesNeeded <= 0 || !field || field.length < tributesNeeded) {
      return [];
    }

    const monstersWithValue = field.map((monster, index) => {
      let value = 0;
      const atk = monster.atk || 0;
      const def = monster.def || 0;
      const level = monster.level || 0;

      value += atk / 500;
      value += def / 1000;
      value += level * 0.2;

      const importantMonsters = [
        "Luminarch Aurora Seraph",
        "Luminarch Celestial Marshal",
        "Luminarch Radiant Lancer",
        "Luminarch Sanctum Protector",
        "Luminarch Moonblade Captain",
        "Luminarch Aegisbearer",
      ];
      if (importantMonsters.includes(monster.name)) value += 5;
      if (monster.mustBeAttacked) value += 2;
      if (
        monster.effects &&
        monster.effects.some(
          (e) => e.timing === "passive" || e.timing === "continuous"
        )
      ) {
        value += 1;
      }
      if (monster.isToken || monster.name.includes("Token")) value -= 3;
      if (atk <= 1000 && level <= 4) value -= 1;

      return { monster, index, value };
    });

    monstersWithValue.sort((a, b) => a.value - b.value);

    const tributeCandidates = monstersWithValue.slice(0, tributesNeeded);
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
      case "Shadow-Heart Coat": {
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
      case "Shadow-Heart Recall": {
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
      default:
        break;
    }
  }
}
