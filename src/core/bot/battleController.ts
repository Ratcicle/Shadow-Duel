import type { BotRuntimePort, BotGamePort } from "../contracts/bot.js";
import type { GameCard } from "../contracts/cards.js";
import type { GamePlayer } from "../contracts/player.js";

/** Attack attempts (resolveCombat calls) the bot may spend in one Battle Phase. */
export const BOT_BATTLE_MAX_ATTEMPTS = 32;
/** Consecutive attempts that leave the battle state unchanged before the bot gives up. */
export const BOT_BATTLE_MAX_ATTEMPTS_WITHOUT_PROGRESS = 3;
/** Poll interval while the duel is busy; waiting spends no budget and records nothing. */
export const BOT_BATTLE_BUSY_RETRY_MS = 20;

// Guard codes that clear on their own once the pending selection/effect/window ends.
const BOT_BATTLE_BUSY_GUARD_CODES: ReadonlySet<string> = new Set([
  "BLOCKED_SELECTION_ACTIVE",
  "BLOCKED_RESOLVING",
  "BLOCKED_CHAIN_WINDOW_OPEN",
  "BLOCKED_FAST_EFFECT_TIMING",
]);

type BattlePlayerSnapshot = Pick<GamePlayer, "lp" | "field">;

/**
 * Battle progress fingerprint: LPs, field instanceIds, attack counters and the
 * monsters each attacker already attacked. An attempt that leaves it unchanged
 * made no progress.
 */
export function getBattleProgressFingerprint(
  players: readonly BattlePlayerSnapshot[],
): string {
  return players
    .map((player) =>
      [
        String(player.lp),
        ...player.field.map(
          (card) =>
            `${card.instanceId}:${card.attacksUsedThisTurn || 0}:` +
            [...(card.attackedMonstersThisTurn || [])].map(String).join(","),
        ),
      ].join("|"),
    )
    .join("#");
}

function getBattlePairKey(attacker: GameCard, target: GameCard | null): string {
  return `${attacker.instanceId}>${target ? target.instanceId : "direct"}`;
}

function getGuardFailureCode(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  if (Reflect.get(result, "ok") !== false) return null;
  const code: unknown = Reflect.get(result, "code");
  return typeof code === "string" ? code : null;
}

const waitBattleDelay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

type BattleCardIdentity = {
  id?: number | undefined;
  instanceId?: number | string;
};

export function isSameBattleCard(
  candidate: BattleCardIdentity | null | undefined,
  original: BattleCardIdentity | null | undefined,
): boolean {
  if (!candidate || !original) return false;
  if (candidate.instanceId != null && original.instanceId != null) {
    return candidate.instanceId === original.instanceId;
  }
  return candidate.id === original.id;
}

export function playBotBattlePhase(
  bot: BotRuntimePort,
  game: BotGamePort,
): void {
  if (game.isDisposed?.()) return;

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
  const battleDelayMs =
    typeof game.aiBattleDelayMs === "number" &&
    Number.isFinite(game.aiBattleDelayMs)
      ? game.aiBattleDelayMs
      : 800;
  const minDeltaToAttack = 0.05;
  const battleTurnCounter = game.turnCounter;
  // Pairs whose attempt changed nothing are not retried in this Battle Phase.
  const rejectedPairs = new Set<string>();
  let attempts = 0;
  let attemptsWithoutProgress = 0;

  const isBattleOngoing = () =>
    !game.isDisposed?.() && !game.gameOver && game.phase === "battle";

  // Only the bot's own Battle Phase is ever ended here.
  const endBattlePhase = () => {
    if (!isBattleOngoing()) return;
    if (game.turn !== bot.id || game.turnCounter !== battleTurnCounter) return;
    game.nextPhase();
  };

  const checkBattleReadiness = (): "ready" | "busy" | "stop" => {
    if (game.isDisposed?.() || game.gameOver) return "stop";
    const readiness = game.canStartAction({
      actor: bot,
      kind: "bot_attack",
      phaseReq: "battle",
      silent: true,
    });
    if (readiness.ok) return "ready";
    return BOT_BATTLE_BUSY_GUARD_CODES.has(readiness.code) ? "busy" : "stop";
  };

  const selectAttack = () => {
    const availableAttackers = bot.field.filter((m) => {
      if (!m || m.cardKind !== "monster") return false;
      if (m.position !== "attack") return false;
      if (m.cannotAttackThisTurn) return false;
      return game.getAttackAvailability?.(m)?.ok ?? true;
    });

    if (!availableAttackers.length) return null;

    let bestAttack: {
      attacker: GameCard;
      target: GameCard | null;
      threshold: number;
    } | null = null;
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
          (attacker.extraAttackTargetRestriction ||
            attacker.passiveExtraAttackTargetRestriction) === "monster"
        );

      const tauntTargets = opponent.field.filter((card) =>
        typeof game.isActiveAttackPriorityTarget === "function"
          ? game.isActiveAttackPriorityTarget(card)
          : card &&
            card.cardKind === "monster" &&
            card.mustBeAttacked &&
            !card.isFacedown,
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
        if (
          target === null &&
          opponent.field.length > 0 &&
          !canDirectAttackNow
        ) {
          continue;
        }
        if (rejectedPairs.has(getBattlePairKey(attacker, target))) continue;

        const simState = bot.cloneGameState(game);
        const simAttacker = simState.bot.field.find((c) =>
          isSameBattleCard(c, attacker),
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
        const attackerSurvived = simState.bot.field.some((c) =>
          isSameBattleCard(c, attacker),
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

        const strategyBattleDelta = bot.strategy?.scoreBattleAttackCandidate?.({
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
          delta += strategyBattleDelta as number;
        } else if (
          Number.isFinite(
            (strategyBattleDelta as { scoreDelta?: number } | null)?.scoreDelta,
          )
        ) {
          delta += (strategyBattleDelta as { scoreDelta: number }).scoreDelta;
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
    return bestAttack && bestDelta > finalThreshold ? bestAttack : null;
  };

  // Each iteration is one complete attack attempt. Readiness, selection and the
  // resolveCombat call run synchronously, so the chosen pair is never stale.
  const runBattleLoop = async (): Promise<void> => {
    while (isBattleOngoing()) {
      const readiness = checkBattleReadiness();
      // A non-busy block (wrong phase/turn, disposed) is not ours to end.
      if (readiness === "stop") return;
      if (readiness === "busy") {
        await waitBattleDelay(BOT_BATTLE_BUSY_RETRY_MS);
        continue;
      }

      const bestAttack = selectAttack();
      if (!bestAttack) {
        await waitBattleDelay(battleDelayMs);
        endBattlePhase();
        return;
      }

      attempts++;
      const fingerprintBefore = getBattleProgressFingerprint([bot, opponent]);
      let result: unknown;
      try {
        // IMPORTANTE: resolveCombat é async, devemos aguardar antes de verificar gameOver
        result = await game.resolveCombat(bestAttack.attacker, bestAttack.target);
      } catch (err: unknown) {
        console.error("[Bot.playBattlePhase] resolveCombat error:", err);
        await waitBattleDelay(battleDelayMs);
        endBattlePhase();
        return;
      }

      const guardCode = getGuardFailureCode(result);
      if (guardCode !== null && !BOT_BATTLE_BUSY_GUARD_CODES.has(guardCode)) {
        return;
      }
      // A transient guard block is not a rejection; anything else must move the state.
      if (guardCode === null) {
        if (
          getBattleProgressFingerprint([bot, opponent]) === fingerprintBefore
        ) {
          rejectedPairs.add(
            getBattlePairKey(bestAttack.attacker, bestAttack.target),
          );
          attemptsWithoutProgress++;
        } else {
          attemptsWithoutProgress = 0;
        }
      }

      if (!isBattleOngoing()) return;
      if (
        attempts >= BOT_BATTLE_MAX_ATTEMPTS ||
        attemptsWithoutProgress >= BOT_BATTLE_MAX_ATTEMPTS_WITHOUT_PROGRESS
      ) {
        console.warn("[Bot.playBattlePhase] Attack attempt limit reached", {
          attempts,
          attemptsWithoutProgress,
        });
        await waitBattleDelay(battleDelayMs);
        endBattlePhase();
        return;
      }
      await waitBattleDelay(
        guardCode === null ? battleDelayMs : BOT_BATTLE_BUSY_RETRY_MS,
      );
    }
  };

  runBattleLoop().catch((err: unknown) => {
    console.error("[Bot.playBattlePhase] Battle loop error:", err);
    endBattlePhase();
  });
}
