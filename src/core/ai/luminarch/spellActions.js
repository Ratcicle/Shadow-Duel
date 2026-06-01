import { assessActionSafety } from "../ChainAwareness.js";
import { calculateMacroPriorityBonus } from "../MacroPlanning.js";
import { estimateCardValue } from "../StrategyUtils.js";
import {
  applyMacroAndSafety,
  buildPrioritizedAction,
} from "../common/actionGeneration.js";
import { buildStrategyAnalysis } from "../common/analysis.js";
import { getGenericSetBackrowActions } from "../common/backrowPlanning.js";
import { mergeActivationActionContext } from "../common/preferencePolicy.js";
import { canActivateSpellTrapEffect } from "../common/previewGuards.js";
import { shouldCommitResourcesNow } from "./multiTurnPlanning.js";
import { shouldPlaySpell } from "./priorities.js";
import { buildLuminarchSpellActionContext } from "./actionContext.js";
import { evaluateLuminarchBackrowSetPolicy } from "./defensePolicy.js";

function getHandSpellActions(context, spellIndicesActivated) {
  const {
    game,
    bot,
    opponent,
    activationContext,
    macroStrategy,
    gameStance,
    verboseEval,
  } = context;
  const actions = [];

  bot.hand.forEach((card, index) => {
    if (card.cardKind !== "spell") return;

    try {
      if (card.name === "Polymerization") return;

      if (verboseEval && bot?.debug) {
        console.log(
          `\n[LuminarchStrategy] Evaluating spell: ${card.name} (${
            card.subtype || "normal"
          })`,
        );
      }

      if (
        game.effectEngine?.canActivateSpellFromHandPreview &&
        typeof game.effectEngine.canActivateSpellFromHandPreview === "function"
      ) {
        const preview = game.effectEngine.canActivateSpellFromHandPreview(
          card,
          bot,
          { activationContext },
        );
        if (verboseEval && bot?.debug) {
          console.log(
            `  Preview: ${preview?.ok ? "ok" : "blocked"} ${
              preview?.reason || ""
            }`,
          );
        }
        if (preview && preview.ok === false) return;
      } else {
        const check = game.effectEngine?.canActivate?.(card, bot);
        if (verboseEval && bot?.debug && check) {
          console.log(
            `  CanActivate: ${check.ok ? "ok" : "blocked"} ${
              check.reason || ""
            }`,
          );
        }
        if (check && !check.ok) return;
      }

      const analysis = buildStrategyAnalysis({ bot, opponent, game });
      const decision = shouldPlaySpell(card, analysis);
      if (verboseEval && bot?.debug) {
        console.log(
          `  shouldPlaySpell: ${decision.yes ? "ok" : "blocked"} ${
            decision.reason || ""
          }`,
        );
      }

      if (!decision.yes) return;

      const resourceCheck = shouldCommitResourcesNow(
        card,
        analysis,
        gameStance,
      );
      if (verboseEval && bot?.debug) {
        console.log(
          `  shouldCommitResourcesNow: ${
            resourceCheck.shouldPlay ? "ok" : "hold"
          } ${resourceCheck.reason || ""}`,
        );
      }
      if (!resourceCheck.shouldPlay) return;

      const spellSafety = assessActionSafety(
        { bot, player: opponent },
        bot,
        opponent,
        "spell",
        card,
      );

      const { priority, macroBuff, safetyScore } = applyMacroAndSafety({
        basePriority: decision.priority || 1,
        actionType: "spell",
        card,
        macroStrategy,
        safety: spellSafety,
        macroBonusFn: calculateMacroPriorityBonus,
        safetyPolicy: {
          very_risky: -15,
          risky: -8,
        },
      });

      actions.push(
        buildPrioritizedAction({
          type: "spell",
          index,
          card,
          priority,
          reason: decision.reason,
          activationContext: mergeActivationActionContext(
            activationContext,
            buildLuminarchSpellActionContext(
              card,
              analysis,
              activationContext.actionContext,
            ),
          ),
          extra: {
            macroBuff,
            safetyScore,
          },
        }),
      );
      spellIndicesActivated.add(index);
    } catch (e) {
      // Silent spell evaluation error
    }
  });

  return actions;
}

function getSpellTrapEffectActions(context) {
  const {
    game,
    bot,
    opponent,
    activationContext,
    macroStrategy,
    gameStance,
  } = context;
  const actions = [];

  (bot.spellTrap || []).forEach((card, index) => {
    if (!card || card.cardKind !== "spell") return;
    if (card.subtype === "field") return;
    if (card.name === "Luminarch Holy Shield") return;

    try {
      if (
        !canActivateSpellTrapEffect(
          game,
          card,
          bot,
          "spellTrap",
          activationContext,
        )
      ) {
        return;
      }

      const analysis = buildStrategyAnalysis({ bot, opponent, game });
      const decision = shouldPlaySpell(card, analysis);
      if (!decision.yes) return;

      const resourceCheck = shouldCommitResourcesNow(
        card,
        analysis,
        gameStance,
      );
      if (!resourceCheck.shouldPlay) return;

      const spellSafety = assessActionSafety(
        { bot, player: opponent },
        bot,
        opponent,
        "spell",
        card,
      );

      const { priority, macroBuff, safetyScore } = applyMacroAndSafety({
        basePriority: decision.priority || 1,
        actionType: "spell",
        card,
        macroStrategy,
        safety: spellSafety,
        macroBonusFn: calculateMacroPriorityBonus,
        safetyPolicy: {
          very_risky: -15,
          risky: -8,
        },
      });

      actions.push(
        buildPrioritizedAction({
          type: "spellTrapEffect",
          index,
          zoneIndex: index,
          card,
          priority,
          reason: decision.reason,
          activationContext: mergeActivationActionContext(
            {
              ...activationContext,
              fromHand: false,
              activationZone: "spellTrap",
              sourceZone: "spellTrap",
            },
            buildLuminarchSpellActionContext(
              card,
              analysis,
              activationContext.actionContext,
            ),
          ),
          extra: {
            macroBuff,
            safetyScore,
          },
        }),
      );
    } catch (e) {
      // Silent spell/trap evaluation error
    }
  });

  return actions;
}

function getSetSpellTrapActions(context, spellIndicesActivated) {
  const { game, bot, opponent } = context;
  const analysis =
    context.analysis || buildStrategyAnalysis({ bot, opponent, game });

  const baseSetPriority = -1;
  return getGenericSetBackrowActions({
    bot,
    game,
    opponent,
    analysis,
    alreadyUsedHandIndices: spellIndicesActivated,
    basePriority: baseSetPriority,
    defaultReason: "setup_backrow",
    policy: {
      shouldSet: (card) => evaluateLuminarchBackrowSetPolicy(card, analysis),
      getPriority: (card, { setDecision }) => {
        if (Number.isFinite(setDecision?.priority)) {
          return setDecision.priority;
        }
        const valueEstimate = estimateCardValue(card, {
          archetype: "Luminarch",
          fieldSpell: bot?.fieldSpell || null,
          preferDefense: true,
        });
        return baseSetPriority + valueEstimate * 0.2;
      },
      getReason: (_card, { setDecision }) =>
        setDecision?.reason || "setup_backrow",
    },
  });
}

export function getLuminarchSpellActions(context) {
  const spellIndicesActivated = new Set();
  return [
    ...getHandSpellActions(context, spellIndicesActivated),
    ...getSpellTrapEffectActions(context),
    ...getSetSpellTrapActions(context, spellIndicesActivated),
  ];
}
