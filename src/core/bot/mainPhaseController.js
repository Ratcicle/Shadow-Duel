import { beamSearchTurn, greedySearchWithEvalV2 } from "../ai/BeamSearch.js";
import { turnLineSearch } from "../ai/TurnLineSearch.js";
import {
  compactPlanningDiffs,
  diffPlanningSummaries,
  fingerprintAction,
  isMeaningfulPlanningDiff,
  summarizePlanningState,
} from "../ai/common/planningDiagnostics.js";
import { botLogger } from "../BotLogger.js";

function hasValue(value) {
  return value !== undefined && value !== null;
}

function resolvePlannerMode(game, profile = {}) {
  const configuredMode = game?.turnLineSearchMode ?? game?.arenaPlannerMode;
  if (configuredMode === "off") return "off";
  if (configuredMode === "always") return "always";
  if (configuredMode === "critical") return "critical";
  if (game?.turnLineSearchEnabled === true) return "always";
  if (profile?.mode) return profile.mode;
  return profile?.enabled === true ? "critical" : "off";
}

export async function playBotMainPhase(bot, game) {
  // Verificar se o jogo já acabou
  if (game.gameOver || game.isDisposed?.()) {
    return;
  }
  game._arenaTracker?.recordProgress?.("bot_main_phase_enter", game, {
    actor: bot.id,
  });

  const opponent = game.player.id === bot.id ? game.bot : game.player;
  const useAutomaticAscension =
    bot.strategy?.shouldUseAutomaticAscensionShortcut?.(game, bot) !==
    false;

  // === LOG DE ESTADO (DEV MODE) ===
  if (bot.debug) {
    console.log(
      `\n[Bot.playMainPhase] 📊 Estado de ${bot.id} no início da main phase:`,
    );
    console.log(
      `  Hand (${bot.hand.length}): ${
        bot.hand.map((c) => c.name).join(", ") || "(vazia)"
      }`,
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
              }`,
          )
          .join(", ") || "(vazio)"
      }`,
    );
    console.log(
      `  Graveyard (${bot.graveyard.length}): ${
        bot.graveyard.map((c) => c.name).join(", ") || "(vazio)"
      }`,
    );
    console.log(`  Field Spell: ${bot.fieldSpell?.name || "(nenhum)"}`);
    console.log(
      `  LP: ${bot.lp} | Summon Count: ${bot.summonCount}/${1 + (bot.additionalNormalSummons || 0)}`,
    );
  }

  let successfulActions = 0;
  let totalAttempts = 0;
  const maxSuccessfulActions = bot.maxChainedActions || 2;
  const maxTotalAttempts = 10; // Limite de segurança contra loops infinitos

  // Track de ações que já falharam neste turno para não tentar novamente
  const failedActionsThisTurn = new Set();

  // Flag para usar evaluateBoardV2
  const useV2Evaluation = true;

  while (
    successfulActions < maxSuccessfulActions &&
    totalAttempts < maxTotalAttempts
  ) {
    if (game.gameOver || game.isDisposed?.()) return;
    totalAttempts++;

    // Try Ascension before other actions if available
    const ascended = useAutomaticAscension
      ? await bot.tryAscensionIfAvailable(game)
      : false;
    if (ascended) {
      // Allow subsequent actions after ascension
      const successfulActionDelayMs = Number.isFinite(
        game?.aiSuccessfulActionDelayMs,
      )
        ? game.aiSuccessfulActionDelayMs
        : game?.phaseDelayMs || 0;
      await new Promise((resolve) =>
        setTimeout(resolve, successfulActionDelayMs),
      );
      if (game.gameOver || game.isDisposed?.()) return;
    }

    const rawActions = bot.generateMainPhaseActions(game);
    const sequencedActions = bot.sequenceActions(rawActions);

    // Filtrar ações que já falharam neste turno
    const actions = sequencedActions.filter((a) => {
      const actionKey = `${a.type}:${a.cardId || a.card?.id || a.index}`;
      return !failedActionsThisTurn.has(actionKey);
    });

    const fallbackActions = bot.filterValidActionsForCurrentState(
      actions,
      game,
    );

    console.log(
      `[Bot.playMainPhase] Generated ${rawActions.length} raw actions, ${actions.length} sequenced actions (${failedActionsThisTurn.size} filtered)`,
    );
    game._arenaTracker?.recordProgress?.("ai_decision_before", game, {
      actor: bot.id,
      attempt: totalAttempts,
      rawActions: rawActions.length,
      sequencedActions: sequencedActions.length,
      actions: actions.length,
      fallbackActions: fallbackActions.length,
      failedThisTurn: failedActionsThisTurn.size,
    });
    if (actions.length > 0) {
      console.log(
        `[Bot.playMainPhase] Actions:`,
        actions.map((a) => `${a.type}:${a.card?.name || a.index}`),
      );
    }

    // 📊 Log de fase vazia
    if (!actions.length) {
      game._arenaTracker?.recordProgress?.("ai_decision_after", game, {
        actor: bot.id,
        attempt: totalAttempts,
        selected: false,
        reason: "no_actions_generated",
      });
      if (botLogger) {
        botLogger.logEmptyPhase(
          bot.id,
          game.turnCounter || 0,
          game.phase || "unknown",
          "NO_ACTIONS_GENERATED",
          {
            lp: game.player?.lp,
            handSize: (game.player?.hand || []).length,
            fieldSize: (game.player?.field || []).length,
            gySize: (game.player?.graveyard || []).length,
          },
        );
      }
      break;
    }

    let bestAction = null;
    let pendingPlannerTrace = null;

    const planningStrategy = bot.strategy || bot;
    const planningContext = {
      game,
      bot: bot,
      strategy: planningStrategy,
      actions,
      fallbackActions,
      attempt: totalAttempts,
      useV2Evaluation,
    };
    const planningProfile =
      typeof planningStrategy.getPlanningProfile === "function"
        ? planningStrategy.getPlanningProfile(game, planningContext) || {}
        : {};
    planningContext.profile = planningProfile;
    const plannerMode = resolvePlannerMode(game, planningProfile);
    const plannerForced = plannerMode === "always";
    const explicitPlannerOptIn =
      plannerMode !== "off" && (plannerForced || planningProfile.enabled === true);
    const shouldUsePlanner =
      explicitPlannerOptIn &&
      (plannerForced ||
      (typeof planningStrategy.shouldUseDeepPlanning === "function"
        ? planningStrategy.shouldUseDeepPlanning(game, planningContext)
        : true));

    if (shouldUsePlanner && actions.length > 0) {
      const plannerBeamWidth =
        (hasValue(game.turnLineSearchBeamWidth)
          ? game.turnLineSearchBeamWidth
          : undefined) ??
        planningProfile.beamWidth ??
        game.arenaPlannerBeamWidth ??
        game.turnLineSearchBeamWidth ??
        game.arenaBeamWidth ??
        2;
      const plannerMaxDepth =
        (hasValue(game.turnLineSearchMaxDepth)
          ? game.turnLineSearchMaxDepth
          : undefined) ??
        planningProfile.maxDepth ??
        game.arenaPlannerMaxDepth ??
        game.turnLineSearchMaxDepth ??
        game.arenaMaxDepth ??
        2;
      const plannerNodeBudget =
        (hasValue(game.turnLineSearchNodeBudget)
          ? game.turnLineSearchNodeBudget
          : undefined) ??
        planningProfile.nodeBudget ??
        game.arenaPlannerNodeBudget ??
        game.turnLineSearchNodeBudget ??
        game.arenaNodeBudget ??
        100;
      const plannerCandidateLimit =
        (hasValue(game.turnLineSearchCandidateLimit)
          ? game.turnLineSearchCandidateLimit
          : undefined) ??
        planningProfile.candidateLimit ??
        game.arenaPlannerCandidateLimit ??
        game.turnLineSearchCandidateLimit ??
        actions.length;
      const plannerTurnMode =
        game.turnLineSearchTurnMode ||
        planningProfile.turnMode ||
        game.arenaPlannerTurnMode ||
        "mainOnly";
      const plannerBattleStepLimit =
        (hasValue(game.turnLineSearchBattleStepLimit)
          ? game.turnLineSearchBattleStepLimit
          : undefined) ??
        planningProfile.battleStepLimit ??
        game.arenaPlannerBattleStepLimit ??
        1;

      console.log(
        `[Bot.playMainPhase] Running TurnLineSearch with ${actions.length} actions (width=${plannerBeamWidth}, depth=${plannerMaxDepth}, budget=${plannerNodeBudget}, battleSteps=${plannerBattleStepLimit})...`,
      );
      const plannerResult = await turnLineSearch(game, planningStrategy, {
        beamWidth: plannerBeamWidth,
        maxDepth: plannerMaxDepth,
        nodeBudget: plannerNodeBudget,
        candidateLimit: plannerCandidateLimit,
        turnMode: plannerTurnMode,
        battleStepLimit: plannerBattleStepLimit,
        useV2Evaluation,
        preGeneratedActions: actions,
        profile: planningProfile,
        planningContext,
      });

      game._arenaTracker?.recordProgress?.("ai_turn_line_search", game, {
        actor: bot.id,
        plannerMode,
        plannerTurnMode,
        plannerBattleStepLimit,
        plannerUsed: Boolean(plannerResult?.action),
        plannedLineLength: plannerResult?.sequence?.length || 0,
        plannedNodesEvaluated: plannerResult?.nodesEvaluated || 0,
        plannedScore: plannerResult?.score ?? null,
        plannedBaseScore: plannerResult?.baseScore ?? null,
        plannedMilestoneScore: plannerResult?.milestoneScore ?? null,
        plannedMilestones: (plannerResult?.milestones || []).slice(0, 8),
        plannedFirstAction: fingerprintAction(plannerResult?.action),
        selectedFirstAction: fingerprintAction(plannerResult?.action),
        plannedTerminalDigest:
          plannerResult?.diagnostics?.terminalSummary || null,
        plannerReason: plannerResult?.reason || "no_plan",
      });

      console.log(`[Bot.playMainPhase] TurnLineSearch result:`, plannerResult);
      if (plannerResult?.action) {
        bestAction = plannerResult.action;
        pendingPlannerTrace = plannerResult;
        console.log(
          `[Bot.playMainPhase] ✅ TurnLineSearch chose:`,
          bestAction,
        );
      } else {
        console.log(`[Bot.playMainPhase] ❌ TurnLineSearch returned no action`);
      }
    }

    // DECISÃO: Usar beam search ou greedy?
    // Se tem 2+ opções, usa beam search. Senão, greedy.
    if (!bestAction && actions.length >= 2) {
      // Beam search com parâmetros do Arena (ou defaults)
      const beamWidth = game.arenaBeamWidth ?? 2;
      const maxDepth = game.arenaMaxDepth ?? 2;
      const nodeBudget = game.arenaNodeBudget ?? 100;

      console.log(
        `[Bot.playMainPhase] Running beam search with ${actions.length} actions (width=${beamWidth}, depth=${maxDepth}, budget=${nodeBudget})...`,
      );
      const searchResult = await beamSearchTurn(game, bot, {
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
      const greedyResult = await greedySearchWithEvalV2(game, bot, {
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
            `[Bot.playMainPhase] 🚨 EMERGENCY FALLBACK: Forcing first action to avoid pass`,
          );
        }
      }
    }

    // BUGFIX: Ultimate fallback - Se search falhou mas temos ações, usar a primeira
    if (!bestAction) {
      let finalFallback = fallbackActions;
      if (!finalFallback.length && actions.length > 0) {
        const regenerated = bot.sequenceActions(
          bot.generateMainPhaseActions(game),
        );
        finalFallback = bot.filterValidActionsForCurrentState(
          regenerated,
          game,
        );
      }

      if (finalFallback.length > 0) {
        bestAction = finalFallback[0];
        console.log(
          `[Bot.playMainPhase] ?? Using ultimate fallback: first valid action`,
          bestAction,
        );
      }
    }

    // Se ainda não tem ação, break
    if (!bestAction) {
      console.log(`[Bot.playMainPhase] ⚠️ No action selected, breaking loop`);
      game._arenaTracker?.recordProgress?.("ai_decision_after", game, {
        actor: bot.id,
        attempt: totalAttempts,
        selected: false,
        reason: "no_action_selected",
      });
      break;
    }

    const selectedStillValid =
      bestAction.type === "simulatedBattle" ||
      bot.filterValidActionsForCurrentState([bestAction], game).length > 0;
    if (!selectedStillValid) {
      const failedKey = `${bestAction.type}:${bestAction.cardId || bestAction.card?.id || bestAction.index}`;
      failedActionsThisTurn.add(failedKey);
      console.log(
        `[Bot.playMainPhase] Selected action no longer valid, retrying: ${failedKey}`,
      );
      game._arenaTracker?.recordProgress?.("ai_decision_after", game, {
        actor: bot.id,
        attempt: totalAttempts,
        selected: false,
        reason: "selected_action_invalid",
        actionType: bestAction.type || null,
        card: bestAction.card?.name || bestAction.cardName || null,
      });
      continue;
    }

    game._arenaTracker?.recordProgress?.("ai_decision_after", game, {
      actor: bot.id,
      attempt: totalAttempts,
      selected: true,
      actionType: bestAction.type || null,
      card: bestAction.card?.name || bestAction.cardName || null,
    });

    if (bestAction.type === "simulatedBattle") {
      console.log(
        `[Bot.playMainPhase] Planner selected battle bridge; advancing to Battle Phase`,
        bestAction,
      );
      game._arenaTracker?.recordProgress?.("ai_plan_phase_bridge", game, {
        actor: bot.id,
        attempt: totalAttempts,
        plannedAction: fingerprintAction(bestAction),
        plannedMilestones: (pendingPlannerTrace?.milestones || []).slice(0, 8),
        plannerReason: pendingPlannerTrace?.reason || null,
      });
      await game.nextPhase();
      return;
    }

    // 📊 Log de decisão (ranking e coerência)
    if (botLogger && actions.length > 0) {
      const sorted = [...actions].sort(
        (a, b) => (b.priority || 0) - (a.priority || 0),
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
          bot.id,
          game.turnCounter || 0,
          game.phase || "unknown",
          actions.length,
          ranking,
          coherence,
          bestAction,
        );
      }
    }

    const actionSuccess = await bot.executeMainPhaseAction(game, bestAction);
    if (pendingPlannerTrace) {
      const expectedSummary =
        pendingPlannerTrace.diagnostics?.firstStepSummary || null;
      const actualSummary = summarizePlanningState(game, {
        bot: bot,
        strategy: planningStrategy,
      });
      const diff = diffPlanningSummaries(expectedSummary, actualSummary);
      const meaningfulDiff = isMeaningfulPlanningDiff(diff);
      const comparePayload = {
        actor: bot.id,
        actionSuccess: !!actionSuccess,
        plannedAction: fingerprintAction(pendingPlannerTrace.action),
        actualAction: fingerprintAction(bestAction),
        selectedFirstAction: fingerprintAction(pendingPlannerTrace.action),
        executedFirstAction: fingerprintAction(bestAction),
        matched: !!actionSuccess && !meaningfulDiff,
        diffSeverity: actionSuccess ? diff.severity : "action_failed",
        mismatchReason: actionSuccess ? diff.severity : "action_failed",
        diffs: compactPlanningDiffs(diff.diffs || [], 6),
        plannedMilestones: (pendingPlannerTrace.milestones || []).slice(0, 8),
        plannerReason: pendingPlannerTrace.reason || null,
      };
      game._arenaTracker?.recordProgress?.(
        actionSuccess
          ? "ai_plan_execution_compare"
          : "ai_plan_execution_failed",
        game,
        comparePayload,
      );
    }
    if (!actionSuccess) {
      // Marcar ação como falhada para não tentar novamente
      const failedKey = `${bestAction.type}:${bestAction.cardId || bestAction.card?.id || bestAction.index}`;
      failedActionsThisTurn.add(failedKey);
      console.log(
        `[Bot.playMainPhase] ❌ Action failed, added to blacklist: ${failedKey}`,
      );

      if (botLogger?.logEmptyPhase) {
        botLogger.logEmptyPhase(
          bot.id,
          game.turnCounter,
          game.phase,
          "ACTION_FAILED",
          {
            lp: bot.lp,
            handSize: bot.hand.length,
            fieldSize: bot.field.length,
            gySize: bot.graveyard.length,
          },
        );
      }
      if (typeof game.updateBoard === "function") {
        game.updateBoard();
      }
      // NÃO dar break aqui - tentar próxima ação disponível
      continue;
    }

    // Incrementar contador de ações bem-sucedidas
    successfulActions += 1;

    const successfulActionDelayMs = Number.isFinite(
      game?.aiSuccessfulActionDelayMs,
    )
      ? game.aiSuccessfulActionDelayMs
      : game?.phaseDelayMs || 0;
    await new Promise((resolve) =>
      setTimeout(resolve, successfulActionDelayMs),
    );
    if (game.gameOver || game.isDisposed?.()) return;
  }

  // Final chance to ascend if no actions left
  if (useAutomaticAscension) {
    await bot.tryAscensionIfAvailable(game);
  }
}
