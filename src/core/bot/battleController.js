export function isSameBattleCard(candidate, original) {
  if (!candidate || !original) return false;
  if (candidate.instanceId != null && original.instanceId != null) {
    return candidate.instanceId === original.instanceId;
  }
  return candidate.id === original.id;
}

export function playBotBattlePhase(bot, game) {
  const guard = game.canStartAction({
    actor: bot,
    kind: "bot_attack",
    phaseReq: "battle",
  });
  if (!guard.ok) {
    console.log(`[Bot.playBattlePhase] ⚠️ Guard blocked:`, guard);
    return;
  }
  console.log(`[Bot.playBattlePhase] ✅ Starting battle phase evaluation`);
  const opponent = bot.resolveOpponent(game);
  if (!opponent) return;
  const battleDelayMs = Number.isFinite(game?.aiBattleDelayMs)
    ? game.aiBattleDelayMs
    : 800;
  const minDeltaToAttack = 0.05;

  const performAttack = () => {
    // Verificar se ainda podemos atacar
    if (game.gameOver) return;
    if (game.phase !== "battle") return; // Fase mudou durante resolução

    const availableAttackers = bot.field.filter((m) => {
      if (!m || m.cardKind !== "monster") return false;
      if (m.position !== "attack") return false;
      if (m.cannotAttackThisTurn) return false;
      return game.getAttackAvailability?.(m)?.ok ?? true;
    });

    if (!availableAttackers.length) {
      setTimeout(() => game.nextPhase(), battleDelayMs);
      return;
    }

    let bestAttack = null;
    let bestDelta = -Infinity;
    let bestAttackerAtk = 0;
    const baseScore = bot.evaluateBoard(game, bot);
    const opponentLp = opponent.lp || 0;
    const totalAtkPotential = availableAttackers.reduce(
      (sum, m) => sum + (m.atk || 0),
      0,
    );

    for (const attacker of availableAttackers) {
      const isSecondAttack = (attacker.attacksUsedThisTurn || 0) >= 1;
      const attackThreshold = isSecondAttack ? 0.0 : minDeltaToAttack;
      const canDirectAttackNow =
        (opponent.field.length === 0 ||
          attacker.canAttackDirectlyThisTurn === true) &&
        !bot.forbidDirectAttacksThisTurn &&
        !attacker.cannotAttackDirectly &&
        !attacker.canAttackAllOpponentMonstersThisTurn &&
        !(
          (attacker.attacksUsedThisTurn || 0) > 0 &&
          attacker.extraAttackTargetRestriction === "monster"
        );

      const tauntTargets = opponent.field.filter(
        (card) =>
          card &&
          card.cardKind === "monster" &&
          !card.isFacedown &&
          card.mustBeAttacked,
      );

      const possibleTargets =
        tauntTargets.length > 0
          ? [...tauntTargets]
          : opponent.field.length
            ? [...opponent.field, ...(canDirectAttackNow ? [null] : [])]
            : canDirectAttackNow
              ? [null]
              : [];

      for (const target of possibleTargets) {
        if (target === null && opponent.field.length > 0 && !canDirectAttackNow) {
          continue;
        }

        const simState = bot.cloneGameState(game);
        const simAttacker = simState.bot.field.find(
          (c) => isSameBattleCard(c, attacker),
        );
        const simTarget = target
          ? simState.player.field.find((c) => isSameBattleCard(c, target))
          : null;

        // 🎯 BOOST: Atacar monstros facedown é geralmente vantajoso
        // - DEF estimado = 1500, então ATK >= 1600 provavelmente vence
        // - Remove ameaça desconhecida do campo
        const attackingFacedown = target && target.isFacedown;
        const highAtkAttacker = (attacker.atk || 0) >= 1600;

        if (!simAttacker) continue;

        bot.simulateBattle(simState, simAttacker, simTarget);
        const scoreAfter = bot.evaluateBoard(simState, simState.bot);
        let delta = scoreAfter - baseScore;
        const opponentLpAfter = simState.player.lp || 0;
        const attackerSurvived = simState.bot.field.some(
          (c) => isSameBattleCard(c, attacker),
        );
        const targetSurvived = target
          ? simState.player.field.some((c) => isSameBattleCard(c, target))
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

        const strategyBattleDelta =
          bot.strategy?.scoreBattleAttackCandidate?.({
            attacker,
            target,
            baseDelta: delta,
            simState,
            game,
            bot: bot,
            opponent,
            isSecondAttack,
            attackerSurvived,
            targetSurvived,
            lethalNow,
            opponentLpAfter,
          });
        if (Number.isFinite(strategyBattleDelta)) {
          delta += strategyBattleDelta;
        } else if (Number.isFinite(strategyBattleDelta?.scoreDelta)) {
          delta += strategyBattleDelta.scoreDelta;
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
      0.05,
    );
    if (bestAttack && bestDelta > finalThreshold) {
      // Verificar se atacante ainda está no campo antes de atacar
      const attackerStillOnField = bot.field.includes(bestAttack.attacker);
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
        game.resolveCombat(bestAttack.attacker, bestAttack.target),
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
