import { isQuickSpell } from "../game/spellTrap/quickSpellRules.js";

function getStrategyForPlayer(game, player) {
  if (player?.strategy) return player.strategy;
  if (game?.bot?.id && game.bot.id === player?.id) return game.bot.strategy || null;
  if (game?.player?.id && game.player.id === player?.id) {
    return game.player.strategy || null;
  }
  return null;
}

function buildResponseContext(baseContext, response) {
  const activationContext =
    response?.activationContext ||
    response?.context?.activationContext ||
    baseContext?.activationContext ||
    null;
  if (!activationContext) return response?.context || baseContext;
  return {
    ...(baseContext || {}),
    ...(response?.context || {}),
    activationContext,
  };
}

/**
 * Bot AI for choosing chain response
 * @param {Object} player
 * @param {Array} activatable
 * @param {ChainContext} context
 * @returns {Promise<Object|null>}
 */
export async function botChooseChainResponse(player, activatable, context) {
  if (!activatable || activatable.length === 0) return null;

  const game = this.game;
  const opponent = this.getOpponent(player);
  const strategy = getStrategyForPlayer(game, player);
  if (typeof strategy?.chooseChainResponse === "function") {
    const strategyResponse = await strategy.chooseChainResponse({
      chainSystem: this,
      game,
      player,
      opponent,
      activatable,
      context,
    });
    if (strategyResponse?.pass === true) {
      this.log?.(
        `Bot strategy passing chain response${
          strategyResponse.reason ? ` (${strategyResponse.reason})` : ""
        }`,
      );
      return null;
    }
    if (strategyResponse?.card && strategyResponse?.effect) {
      const responseContext = buildResponseContext(context, strategyResponse);
      const selections =
        strategyResponse.selections ??
        (await this.getBotSelectionsForEffect(
          strategyResponse.card,
          strategyResponse.effect,
          player,
          responseContext,
        ));
      return {
        ...strategyResponse,
        context: responseContext,
        selections,
      };
    }
  }
  const holyShieldOption = activatable.find(
    (option) => option?.card?.name === "Luminarch Holy Shield",
  );
  if (holyShieldOption) {
    const luminarchTargets = (player?.field || []).filter(
      (card) =>
        card &&
        card.cardKind === "monster" &&
        card.archetype === "Luminarch" &&
        !card.isFacedown,
    );
    const oppAttackers = (opponent?.field || []).filter(
      (card) =>
        card &&
        card.cardKind === "monster" &&
        !card.isFacedown &&
        card.position === "attack",
    );

    const wouldLoseOrTakeDamage = (attacker, defender) => {
      if (!attacker || !defender)
        return { loseMonster: false, takeDamage: false };
      const atk = attacker.atk || 0;
      const isDefense = defender.position === "defense";
      const defStat = isDefense ? defender.def || 0 : defender.atk || 0;

      if (!isDefense) {
        if (atk > defStat) return { loseMonster: true, takeDamage: true };
        if (atk === defStat) return { loseMonster: true, takeDamage: false };
        return { loseMonster: false, takeDamage: false };
      }

      if (atk > defStat) {
        return {
          loseMonster: true,
          takeDamage: !!attacker.piercing,
        };
      }
      return { loseMonster: false, takeDamage: false };
    };

    const attacker = context?.attacker || null;
    const defender = context?.defender || context?.target || null;
    const defenderOwnerId =
      context?.defenderOwner?.id ||
      context?.targetOwner?.id ||
      (defender?.owner === "player"
        ? this.game?.player?.id
        : this.game?.bot?.id);
    const attackerOwnerId = context?.attackerOwner?.id || attacker?.owner;

    const isDefendingSelf =
      defender && defenderOwnerId && defenderOwnerId === player.id;
    const isOpponentAttack =
      attacker && attackerOwnerId && attackerOwnerId !== player.id;
    const isBattleContext =
      context?.type === "attack_declaration" ||
      context?.type === "battle_damage";
    const isHolyShieldTiming =
      isBattleContext &&
      isOpponentAttack &&
      isDefendingSelf &&
      defender?.archetype === "Luminarch" &&
      !defender?.isFacedown;

    let directBattleThreat = false;
    if (isHolyShieldTiming) {
      const outcome = wouldLoseOrTakeDamage(attacker, defender);
      directBattleThreat = outcome.loseMonster || outcome.takeDamage;
    }

    const multipleAttackers = oppAttackers.length >= 2;
    const anyVulnerableTarget =
      multipleAttackers &&
      luminarchTargets.some((monster) =>
        oppAttackers.some((opp) => {
          const outcome = wouldLoseOrTakeDamage(opp, monster);
          return outcome.loseMonster || outcome.takeDamage;
        }),
      );

    if (
      isHolyShieldTiming &&
      luminarchTargets.length > 0 &&
      (directBattleThreat || anyVulnerableTarget)
    ) {
      const selections = await this.getBotSelectionsForEffect(
        holyShieldOption.card,
        holyShieldOption.effect,
        player,
        holyShieldOption.context || context,
      );
      return { ...holyShieldOption, selections };
    }
  }

  // Evaluate each activatable card for strategic value
  const evaluatedOptions = activatable.map((option) => {
    let priority = 0;
    const card = option.card;
    const effect = option.effect;

    // Counter Traps: highest priority against important plays
    if (card.subtype === "counter" || effect?.speed === 3) {
      priority += 100;
    }

    // Mirror Force: High priority when opponent attacks with multiple monsters
    if (
      card.name === "Mirror Force" &&
      context?.type === "attack_declaration"
    ) {
      const opponentAttackMonsters =
        opponent?.field?.filter(
          (m) => m && !m.isFacedown && m.position === "attack",
        ).length || 0;
      priority += 50 + opponentAttackMonsters * 20;
    }

    // Call of the Haunted: Value based on graveyard monsters
    if (card.name === "Call of the Haunted") {
      const graveyardMonsters =
        player?.graveyard?.filter((c) => c.cardKind === "monster").length ||
        0;
      const bestMonsterAtk = Math.max(
        ...(player?.graveyard || [])
          .filter((c) => c.cardKind === "monster")
          .map((c) => c.atk || 0),
        0,
      );
      priority +=
        30 +
        Math.min(graveyardMonsters * 5, 25) +
        Math.floor(bestMonsterAtk / 100);
    }

    // Void Mirror Dimension: High priority if we have matching level monsters
    if (card.name === "Void Mirror Dimension" && context?.type === "summon") {
      const summonedLevel = context.card?.level || 0;
      const matchingMonsters =
        player?.hand?.filter(
          (c) => c.cardKind === "monster" && c.level === summonedLevel,
        ).length || 0;
      if (matchingMonsters > 0) {
        priority += 60 + matchingMonsters * 10;
      }
    }

    // General trap value: consider game state
    if (card.cardKind === "trap") {
      // Higher priority if we're behind on field presence
      const myFieldCount = player?.field?.filter((m) => m).length || 0;
      const oppFieldCount = opponent?.field?.filter((m) => m).length || 0;
      if (oppFieldCount > myFieldCount) {
        priority += 15;
      }

      // Higher priority if LP is low
      if (player?.lp < 2000) {
        priority += 20;
      }
    }

    if (isQuickSpell(card)) {
      priority += 10;
      if (card.name === "Luminarch Holy Shield") {
        // CRITICAL: Holy Shield só deve ser ativado em contextos de batalha do OPONENTE
        // Nunca ativar no próprio turno ou em resposta aos próprios summons
        const isOpponentAction =
          typeof context?.isOpponentAttack === "boolean"
            ? context.isOpponentAttack
            : context?.player?.id !== player?.id;
        const isBattleContext =
          context?.type === "attack_declaration" ||
          context?.type === "battle_damage";

        if (isBattleContext) {
          // Battle threats are handled by the dedicated Holy Shield block
          // above. If execution reaches this fallback, the attack is not
          // worth spending the shield on.
          priority = -100;
        } else if (!isOpponentAction) {
          // Próprio turno ou própria ação = NÃO ATIVAR
          priority = -100;
        } else if (context?.type === "effect_targeted") {
          priority += 40;
        } else {
          // Contexto não-battle do oponente = baixa prioridade
          priority -= 20;
        }
        if (isOpponentAction && isBattleContext && player?.lp < 3000) {
          priority += 10;
        }
      }
    }

    return { ...option, priority };
  });

  // Sort by priority (highest first)
  evaluatedOptions.sort((a, b) => b.priority - a.priority);

  // Get best option
  const bestOption = evaluatedOptions[0];

  // Se a melhor opção tem priority <= 0, passar automaticamente
  if (bestOption.priority <= 0) {
    this.log(
      `Bot passing (best option priority: ${bestOption.priority} - too low)`,
    );
    return null;
  }

  // Activation threshold based on priority
  // High priority (70+): 80% chance to activate
  // Medium priority (40-69): 50% chance to activate
  // Low priority (1-39): 20% chance to activate
  let activationChance = 0.2;
  if (bestOption.priority >= 70) {
    activationChance = 0.8;
  } else if (bestOption.priority >= 40) {
    activationChance = 0.5;
  }

  if (Math.random() < activationChance) {
    this.log(
      `Bot activating ${bestOption.card.name} (priority: ${bestOption.priority})`,
    );

    // Get selections if the effect requires targets
    const selections = await this.getBotSelectionsForEffect(
      bestOption.card,
      bestOption.effect,
      player,
      bestOption.context || context,
    );

    return { ...bestOption, selections };
  }

  this.log(`Bot passing (best option priority: ${bestOption.priority})`);
  return null;
}

/**
 * Get bot selections for an effect that requires targets
 * @param {Object} card
 * @param {Object} effect
 * @param {Object} player
 * @param {ChainContext} context
 * @returns {Promise<Object|null>}
 */
export async function getBotSelectionsForEffect(card, effect, player, context) {
  if (!effect?.targets || !Array.isArray(effect.targets)) {
    return null;
  }

  const effectEngine = this.game?.effectEngine;
  if (!effectEngine) return null;

  const ctx = {
    ...(context || {}),
    source: card,
    player,
    opponent: this.getOpponent(player),
    defender: context?.defender || context?.target,
    attacker: context?.attacker,
    attackerOwner: context?.attackerOwner,
    defenderOwner: context?.defenderOwner,
    activationContext: {
      ...(context?.activationContext || {}),
      autoSelectSingleTarget:
        context?.activationContext?.autoSelectSingleTarget !== false,
      logTargets: context?.activationContext?.logTargets === true,
    },
  };

  const targetResult = effectEngine.resolveTargets(effect.targets, ctx, null);
  if (targetResult?.ok === false) {
    return null;
  }

  const baseTargets = targetResult?.targets || {};
  if (!targetResult?.needsSelection) {
    return Object.keys(baseTargets).length > 0 ? baseTargets : null;
  }

  if (
    !targetResult.selectionContract ||
    typeof this.game?.autoSelector?.select !== "function"
  ) {
    return Object.keys(baseTargets).length > 0 ? baseTargets : null;
  }

  const autoResult = this.game.autoSelector.select(
    targetResult.selectionContract,
    {
      owner: player,
      activationContext: ctx.activationContext,
      selectionKind: "target",
    },
  );

  if (!autoResult?.ok) {
    return Object.keys(baseTargets).length > 0 ? baseTargets : null;
  }

  const resolvedSelections = this.resolveSelectionsToCards(
    autoResult.selections || {},
    targetResult.selectionContract.requirements || [],
    player,
  );

  const mergedSelections = {
    ...baseTargets,
    ...resolvedSelections,
  };

  return Object.keys(mergedSelections).length > 0 ? mergedSelections : null;
}

/**
 * Select best targets from candidates based on strategy
 * @param {Array} candidates
 * @param {number} count
 * @param {Object} targetDef
 * @returns {Array}
 */
export function selectBestTargets(candidates, count, targetDef) {
  if (!candidates || candidates.length === 0) return [];

  // Sort candidates by strategic value
  const sorted = [...candidates].sort((a, b) => {
    // Prefer higher ATK monsters
    const aAtk = a.atk || 0;
    const bAtk = b.atk || 0;
    return bAtk - aAtk;
  });

  return sorted.slice(0, Math.min(count, sorted.length));
}
