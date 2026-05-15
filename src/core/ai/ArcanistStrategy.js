import BaseStrategy from "./BaseStrategy.js";
import { buildStrategyAnalysis } from "./common/analysis.js";
import {
  getStrongestAttackThreat,
  getStrongestBattleThreat,
} from "./common/cardStats.js";
import {
  applyGenericSimulatedMainPhaseAction,
  resolveSimulatedHandIndex,
} from "./common/simulation.js";
import {
  ARCANIST_NAMES,
  CARD_KNOWLEDGE,
  controlsArcanistEquip,
  getInkCounters,
  getStoredBlueprintCount,
  hasArcanistEquip,
  isArcanist,
  isArcanistMonster,
  isArcanistSpell,
} from "./arcanist/knowledge.js";
import { COMBO_DATABASE, detectAvailableCombos } from "./arcanist/combos.js";
import {
  buildArcanistActivationContext,
  evaluateRecruitCandidate as evaluateArcanistRecruitCandidate,
  getBestGrimoireHostNames,
  getTributeRequirementFor as getArcanistTributeRequirementFor,
  rankSearchCandidates as rankArcanistSearchCandidates,
  selectBestTributes as selectBestArcanistTributes,
  shouldActivateHandIgnition,
  shouldActivateMonsterEffect,
  shouldActivateSpellTrapEffect,
  shouldPlaySpell,
  shouldSummonMonster,
} from "./arcanist/priorities.js";
import {
  evaluateArcanistCardValue,
  evaluateBoardArcanist,
} from "./arcanist/scoring.js";

function getActualGame(game) {
  return game?._gameRef || game;
}

function isSimulatedState(game) {
  return game?._isPerspectiveState === true;
}

function removeFromZone(player, zoneName, card) {
  const zone = player?.[zoneName];
  if (!Array.isArray(zone)) return false;
  const index = zone.indexOf(card);
  if (index < 0) return false;
  zone.splice(index, 1);
  return true;
}

function pushToZone(player, zoneName, card) {
  if (!player || !card) return;
  if (!Array.isArray(player[zoneName])) player[zoneName] = [];
  player[zoneName].push(card);
}

function findOpponentTarget(state) {
  const opponent = state?.player;
  const candidates = [
    ...(opponent?.field || []),
    ...(opponent?.spellTrap || []),
    ...(opponent?.fieldSpell ? [opponent.fieldSpell] : []),
  ].filter(Boolean);
  return candidates
    .slice()
    .sort((a, b) => evaluateArcanistCardValue(b) - evaluateArcanistCardValue(a))[0];
}

function removeOpponentCard(state, card, destination) {
  const opponent = state?.player;
  if (!opponent || !card) return false;
  if (opponent.fieldSpell === card) {
    opponent.fieldSpell = null;
  } else if (!removeFromZone(opponent, "field", card)) {
    removeFromZone(opponent, "spellTrap", card);
  }
  pushToZone(opponent, destination, card);
  return true;
}

export default class ArcanistStrategy extends BaseStrategy {
  constructor(bot) {
    super(bot);
    this.cardKnowledge = CARD_KNOWLEDGE;
    this.knownCombos = COMBO_DATABASE;
    this.currentAnalysis = null;
    this.thoughtProcess = [];
  }

  get archetypeLabel() {
    return "Arcanist";
  }

  think(thought) {
    this.thoughtProcess.push(thought);
    if (this.bot?.debug) {
      console.log(`[Arcanist AI] ${thought}`);
    }
  }

  analyzeGameState(game) {
    this.thoughtProcess = [];

    const simulated = isSimulatedState(game);
    const actor = simulated ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(game, actor);
    const base = buildStrategyAnalysis({
      bot: actor,
      opponent,
      game,
      strategy: this,
    });

    const faceUpArcanists = (base.field || []).filter(
      (card) => isArcanistMonster(card) && !card.isFacedown,
    );
    const equippedArcanists = faceUpArcanists.filter(hasArcanistEquip);
    const arcanistSpellsInGY = (base.graveyard || []).filter(isArcanistSpell);
    const inkRivers = (base.spellTrap || []).filter(
      (card) => card?.name === ARCANIST_NAMES.INK_RIVER && !card.isFacedown,
    );
    const grimoireCards = (base.spellTrap || []).filter(
      (card) => card?.name === ARCANIST_NAMES.GRIMOIRE && !card.isFacedown,
    );

    const analysis = {
      ...base,
      player: actor,
      opponent,
      fieldCapacity: Math.max(0, 5 - (base.field || []).length),
      canNormalSummon: base.summonAvailable,
      faceUpArcanists,
      equippedArcanists,
      arcanistEquipCount: (base.spellTrap || []).filter(
        (card) => !card.isFacedown && card.subtype === "equip" && isArcanist(card),
      ).length,
      hasArcanistEquip: controlsArcanistEquip(actor),
      validGrimoireHosts: faceUpArcanists.filter(
        (card) => !hasArcanistEquip(card),
      ),
      grimoireStoredCount: grimoireCards.reduce(
        (sum, card) => sum + getStoredBlueprintCount(card),
        0,
      ),
      inkRiverCounters: inkRivers.reduce(
        (sum, card) => sum + getInkCounters(card),
        0,
      ),
      arcanistSpellsInGY: arcanistSpellsInGY.length,
      oppStrongestAtk: getStrongestAttackThreat(base.oppField || [], {
        includeBoosts: true,
      }),
      oppStrongestBattle: getStrongestBattleThreat(base.oppField || [], {
        includeBoosts: true,
      }),
      availableCombos: [],
    };

    analysis.availableCombos = detectAvailableCombos(analysis);
    this.currentAnalysis = analysis;
    return analysis;
  }

  evaluateBoard(gameOrState, perspectivePlayer) {
    return evaluateBoardArcanist(
      gameOrState,
      perspectivePlayer,
      this.getOpponent.bind(this),
    );
  }

  evaluateBoardV2(gameOrState, perspectivePlayer) {
    return this.evaluateBoard(gameOrState, perspectivePlayer);
  }

  buildActivationContextForEffect({ sourceCard, player, game } = {}) {
    if (!sourceCard || !player || !game) return null;
    const analysis = this.analyzeGameState(game);
    return buildArcanistActivationContext(sourceCard, analysis);
  }

  canUsePreview(game, previewFn) {
    if (isSimulatedState(game)) return true;
    const actualGame = getActualGame(game);
    if (!actualGame?.effectEngine || typeof previewFn !== "function") {
      return true;
    }
    try {
      const preview = previewFn(actualGame);
      return preview ? preview.ok !== false : true;
    } catch (error) {
      if (this.bot?.debug) {
        console.warn("[ArcanistStrategy] Preview check failed:", error);
      }
      return false;
    }
  }

  getSpellActions(game, bot, analysis) {
    const actions = [];
    for (const [index, card] of (bot.hand || []).entries()) {
      if (!card || card.cardKind !== "spell") continue;
      const decision = shouldPlaySpell(card, analysis);
      if (!decision.yes) continue;

      const activationContext = buildArcanistActivationContext(card, analysis);
      const canActivate = this.canUsePreview(game, (actualGame) =>
        actualGame.effectEngine.canActivateSpellFromHandPreview(card, bot, {
          activationContext,
        }),
      );
      if (!canActivate) continue;

      actions.push({
        type: "spell",
        index,
        cardId: card.id,
        cardName: card.name,
        priority: decision.priority || 1,
        reason: decision.reason,
        activationContext,
      });
    }
    return actions;
  }

  getSetSpellTrapActions(_game, bot) {
    if ((bot.spellTrap || []).length >= 5) return [];

    const actions = [];
    for (const [index, card] of (bot.hand || []).entries()) {
      if (!card) continue;
      const isReactiveBackrow =
        card.cardKind === "trap" ||
        (card.cardKind === "spell" && card.subtype === "quick");
      if (!isReactiveBackrow) continue;

      actions.push({
        type: "set_spell_trap",
        index,
        cardId: card.id,
        cardName: card.name,
        priority: -1,
        reason: "prepare reactive backrow",
      });
    }

    return actions;
  }

  getSummonActions(game, bot, analysis) {
    const actions = [];
    if (!analysis.canNormalSummon || analysis.fieldCapacity <= 0) {
      return actions;
    }

    for (const [index, card] of (bot.hand || []).entries()) {
      if (!card || card.cardKind !== "monster") continue;
      if (card.cannotBeNormalSummonedOrSet) continue;

      const tributeInfo = this.getTributeRequirementFor(card, bot);
      const decision = shouldSummonMonster(card, analysis, tributeInfo);
      if (!decision.yes) continue;

      actions.push({
        type: "summon",
        index,
        cardId: card.id,
        cardName: card.name,
        position: decision.position || "attack",
        facedown: false,
        priority: decision.priority || 1,
        reason: decision.reason,
      });
    }

    return actions;
  }

  getHandIgnitionActions(game, bot, analysis) {
    const actions = [];
    for (const [index, card] of (bot.hand || []).entries()) {
      if (!card || card.cardKind !== "monster") continue;
      const effect = (card.effects || []).find(
        (entry) =>
          entry && entry.timing === "ignition" && entry.requireZone === "hand",
      );
      if (!effect) continue;

      const decision = shouldActivateHandIgnition(card, analysis);
      if (!decision.yes) continue;

      const activationContext = buildArcanistActivationContext(card, analysis);
      const canActivate = this.canUsePreview(game, (actualGame) =>
        actualGame.effectEngine.canActivateMonsterEffectPreview(
          card,
          bot,
          "hand",
          null,
          { activationContext },
        ),
      );
      if (!canActivate) continue;

      actions.push({
        type: "handIgnition",
        index,
        cardId: card.id,
        cardName: card.name,
        effectId: effect.id,
        priority: decision.priority || 1,
        reason: decision.reason,
        activationContext,
      });
    }
    return actions;
  }

  getFieldEffectActions(game, bot, analysis) {
    const card = bot.fieldSpell;
    if (!card || card.name !== ARCANIST_NAMES.GRAND_LIBRARY) return [];

    const hasMonster = analysis.faceUpArcanists.length > 0;
    const canPayStarter = !hasMonster && (bot.lp || 0) > 2200;
    if (!hasMonster && !canPayStarter) return [];
    if (hasMonster) {
      const hasActiveGrimoire = (bot.spellTrap || []).some(
        (spell) =>
          spell?.name === ARCANIST_NAMES.GRIMOIRE && !spell.isFacedown,
      );
      const hasDeckGrimoire = (bot.deck || []).some(
        (candidate) => candidate?.name === ARCANIST_NAMES.GRIMOIRE,
      );
      if (hasActiveGrimoire || !hasDeckGrimoire) return [];
    }

    const activationContext = buildArcanistActivationContext(card, analysis);
    const canActivate = this.canUsePreview(game, (actualGame) =>
      actualGame.effectEngine.canActivateFieldSpellEffectPreview(
        card,
        bot,
        null,
        { activationContext },
      ),
    );
    if (!canActivate) return [];

    return [
      {
        type: "fieldEffect",
        cardId: card.id,
        cardName: card.name,
        priority: hasMonster ? 12 : 13,
        reason: hasMonster ? "search Grimoire" : "recruit Arcanist starter",
        activationContext,
      },
    ];
  }

  getSpellTrapEffectActions(game, bot, analysis) {
    const actions = [];
    for (const [zoneIndex, card] of (bot.spellTrap || []).entries()) {
      if (!card || card.cardKind !== "spell" || card.isFacedown) continue;
      const effect = (card.effects || []).find(
        (entry) =>
          entry &&
          entry.timing === "ignition" &&
          (!entry.requireZone || entry.requireZone === "spellTrap"),
      );
      if (!effect) continue;

      const decision = shouldActivateSpellTrapEffect(card, analysis);
      if (!decision.yes) continue;

      const activationContext = buildArcanistActivationContext(card, analysis);
      const canActivate = this.canUsePreview(game, (actualGame) =>
        actualGame.effectEngine.canActivateSpellTrapEffectPreview(
          card,
          bot,
          "spellTrap",
          null,
          { activationContext },
        ),
      );
      if (!canActivate) continue;

      actions.push({
        type: "spellTrapEffect",
        index: zoneIndex,
        zoneIndex,
        cardId: card.id,
        cardName: card.name,
        priority: decision.priority || 1,
        reason: decision.reason,
        activationContext,
      });
    }
    return actions;
  }

  getMonsterEffectActions(game, bot, analysis) {
    const actions = [];
    for (const [fieldIndex, card] of (bot.field || []).entries()) {
      if (!card || card.cardKind !== "monster" || card.isFacedown) continue;
      const effect = (card.effects || []).find(
        (entry) =>
          entry &&
          entry.timing === "ignition" &&
          (!entry.requireZone || entry.requireZone === "field"),
      );
      if (!effect) continue;

      const decision = shouldActivateMonsterEffect(card, analysis);
      if (!decision.yes) continue;

      const activationContext = buildArcanistActivationContext(card, analysis);
      const canActivate = this.canUsePreview(game, (actualGame) =>
        actualGame.effectEngine.canActivateMonsterEffectPreview(
          card,
          bot,
          "field",
          null,
          { activationContext },
        ),
      );
      if (!canActivate) continue;

      actions.push({
        type: "monsterEffect",
        fieldIndex,
        cardId: card.id,
        cardName: card.name,
        priority: decision.priority || 1,
        reason: decision.reason,
        activationContext,
      });
    }
    return actions;
  }

  generateMainPhaseActions(game) {
    const analysis = this.analyzeGameState(game);
    const bot = analysis.player;
    const actions = [
      ...this.getHandIgnitionActions(game, bot, analysis),
      ...this.getFieldEffectActions(game, bot, analysis),
      ...this.getSpellTrapEffectActions(game, bot, analysis),
      ...this.getMonsterEffectActions(game, bot, analysis),
      ...this.getSpellActions(game, bot, analysis),
      ...this.getSummonActions(game, bot, analysis),
      ...this.getSetSpellTrapActions(game, bot, analysis),
    ];

    if (bot?.debug) {
      this.think(
        `Generated ${actions.length} Arcanist actions: ${actions
          .map((action) => `${action.type}:${action.cardName || action.cardId}`)
          .join(", ")}`,
      );
    }

    return this.integrateP2IntoActionSelection(
      game,
      this.sequenceActions(actions),
      analysis,
    );
  }

  sequenceActions(actions = []) {
    const typeOrder = {
      handIgnition: 0,
      fieldEffect: 1,
      spellTrapEffect: 2,
      monsterEffect: 3,
      spell: 4,
      summon: 5,
      set_spell_trap: 6,
    };

    return [...actions].sort((a, b) => {
      const priorityA = a.priority ?? 0;
      const priorityB = b.priority ?? 0;
      if (priorityA !== priorityB) return priorityB - priorityA;
      return (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
    });
  }

  getTributeRequirementFor(card, playerState) {
    return getArcanistTributeRequirementFor(card, playerState);
  }

  selectBestTributes(field, tributesNeeded, cardToSummon, context = {}) {
    const analysis =
      context.evaluationContext ||
      this.currentAnalysis || {
        field: context.botState?.field || field || [],
        oppField: context.oppField || [],
      };
    return selectBestArcanistTributes(field, tributesNeeded, cardToSummon, {
      ...context,
      evaluationContext: analysis,
    });
  }

  rankSearchCandidates(cards, action = {}, ctx = {}) {
    const game = ctx.game || ctx.ctx?.game || null;
    const analysis = game ? this.analyzeGameState(game) : this.currentAnalysis;
    return rankArcanistSearchCandidates(cards, action, {
      ...ctx,
      analysis,
    });
  }

  evaluateRecruitCandidate(candidates, context = {}) {
    const analysis = context.game
      ? this.analyzeGameState(context.game)
      : this.currentAnalysis;
    return evaluateArcanistRecruitCandidate(candidates, {
      ...context,
      analysis,
    });
  }

  chooseSpecialSummonPosition(card, context = {}) {
    const game = context.game;
    const opponent = game ? this.getOpponent(game, context.player || this.bot) : null;
    const strongest = getStrongestBattleThreat(opponent?.field || [], {
      includeBoosts: true,
    });

    if (card?.name === ARCANIST_NAMES.TERA && strongest >= 1500) {
      return "defense";
    }
    if ((card?.def || 0) > (card?.atk || 0) + 300 && strongest > (card?.atk || 0)) {
      return "defense";
    }
    return "attack";
  }

  simulateMainPhaseAction(state, action) {
    return applyGenericSimulatedMainPhaseAction(state, action, {
      archetype: "Arcanist",
      guardLabel: "ArcanistStrategy",
      getTributeRequirementFor: this.getTributeRequirementFor.bind(this),
      selectBestTributes: this.selectBestTributes.bind(this),
      placeSpellCard: this.placeSpellCard.bind(this),
      actionOverrides: {
        handIgnition: ({ state: simState, action: simAction }) =>
          this.simulateHandIgnition(simState, simAction),
        spell: ({ state: simState, action: simAction }) =>
          this.simulateArcanistSpell(simState, simAction),
        fieldEffect: ({ state: simState }) =>
          this.simulateGrandLibraryEffect(simState),
      },
    });
  }

  simulateHandIgnition(state, action) {
    const player = state.bot;
    const handIndex = resolveSimulatedHandIndex(player, action, "monster");
    const card = player.hand?.[handIndex];
    if (!card || card.name !== ARCANIST_NAMES.ALBUS) return false;
    if (!player.field?.some(isArcanistMonster)) return true;
    if ((player.field || []).length >= 5) return true;
    player.hand.splice(handIndex, 1);
    player.field.push({
      ...card,
      position: "attack",
      isFacedown: false,
      hasAttacked: false,
      attacksUsedThisTurn: 0,
    });
    return true;
  }

  simulateArcanistSpell(state, action) {
    const player = state.bot;
    const handIndex = resolveSimulatedHandIndex(player, action, "spell");
    const card = player.hand?.[handIndex];
    if (!card) return false;

    if (card.name === ARCANIST_NAMES.GRIMOIRE) {
      const analysis = this.analyzeGameState(state);
      const hostName = getBestGrimoireHostNames(analysis)[0];
      const host =
        (player.field || []).find(
          (candidate) => candidate.name === hostName && !candidate.isFacedown,
        ) ||
        (player.field || []).find(
          (candidate) => isArcanistMonster(candidate) && !candidate.isFacedown,
        );
      if (!host) return true;
      player.hand.splice(handIndex, 1);
      card.equippedTo = host;
      if (!Array.isArray(host.equips)) host.equips = [];
      host.equips.push(card);
      player.spellTrap = player.spellTrap || [];
      player.spellTrap.push(card);
      return true;
    }

    if (card.name === ARCANIST_NAMES.SEISMIC_IMPACT) {
      const equippedHost = (player.field || []).find(
        (candidate) =>
          isArcanistMonster(candidate) &&
          !candidate.isFacedown &&
          hasArcanistEquip(candidate),
      );
      const equipCost = (player.spellTrap || []).find(
        (candidate) =>
          candidate &&
          !candidate.isFacedown &&
          isArcanistSpell(candidate) &&
          candidate.subtype === "equip",
      );
      if (!equippedHost || !equipCost) return true;
      const target = findOpponentTarget(state);
      if (!target) return true;
      player.hand.splice(handIndex, 1);
      pushToZone(player, "graveyard", card);
      removeFromZone(player, "spellTrap", equipCost);
      for (const monster of player.field || []) {
        if (Array.isArray(monster.equips)) {
          monster.equips = monster.equips.filter((equip) => equip !== equipCost);
        }
      }
      equipCost.equippedTo = null;
      pushToZone(player, "graveyard", equipCost);
      removeOpponentCard(state, target, "banished");
      return true;
    }

    return false;
  }

  simulateGrandLibraryEffect(state) {
    const player = state.bot;
    const library = player.fieldSpell;
    if (!library || library.name !== ARCANIST_NAMES.GRAND_LIBRARY) {
      return false;
    }

    const hasMonster = (player.field || []).some(isArcanistMonster);
    if (!hasMonster) {
      if ((player.lp || 0) <= 2200 || (player.field || []).length >= 5) {
        return true;
      }
      const analysis = this.analyzeGameState(state);
      const candidates = (player.deck || []).filter(
        (card) =>
          isArcanistMonster(card) &&
          (card.level || 0) <= 4 &&
          card.cardKind === "monster",
      );
      const recruit = this.evaluateRecruitCandidate(candidates, {
        game: state,
        player,
        source: library,
        analysis,
      }).best;
      if (!recruit) return true;
      removeFromZone(player, "deck", recruit);
      player.lp = Math.max(0, (player.lp || 0) - 2000);
      player.field.push({
        ...recruit,
        position: "attack",
        isFacedown: false,
        hasAttacked: false,
        attacksUsedThisTurn: 0,
      });
      return true;
    }

    const grimoire = (player.deck || []).find(
      (card) => card.name === ARCANIST_NAMES.GRIMOIRE,
    );
    if (grimoire) {
      removeFromZone(player, "deck", grimoire);
      pushToZone(player, "hand", grimoire);
    }
    return true;
  }
}
