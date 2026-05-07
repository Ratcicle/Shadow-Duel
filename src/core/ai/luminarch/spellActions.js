import { assessActionSafety } from "../ChainAwareness.js";
import { calculateMacroPriorityBonus } from "../MacroPlanning.js";
import { estimateCardValue } from "../StrategyUtils.js";
import { buildStrategyAnalysis } from "../common/analysis.js";
import { shouldCommitResourcesNow } from "./multiTurnPlanning.js";
import { shouldPlaySpell } from "./priorities.js";
import { buildLuminarchSpellActionContext } from "./actionContext.js";

function getHandSpellActions(context, spellIndicesActivated) {
  const {
    game,
    bot,
    opponent,
    activationContext,
    macroStrategy,
    gameStance,
    fusionOpportunity,
    verboseEval,
  } = context;
  const actions = [];

  bot.hand.forEach((card, index) => {
    if (card.cardKind !== "spell") return;

    try {
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

      let priority = decision.priority || 1;
      const macroBuff = calculateMacroPriorityBonus(
        "spell",
        card,
        macroStrategy,
      );
      priority += macroBuff;

      if (card.name === "Polymerization" && fusionOpportunity) {
        if (fusionOpportunity.decision.shouldPrioritize) {
          priority = fusionOpportunity.decision.priority;
          if (bot?.debug) {
            console.log(
              `[LuminarchStrategy] Polymerization priority override: ${priority} (${fusionOpportunity.decision.reason})`,
            );
          }
        }
      }

      const spellSafety = assessActionSafety(
        { bot, player: opponent },
        bot,
        opponent,
        "spell",
        card,
      );
      if (spellSafety.recommendation === "very_risky") {
        priority -= 15;
      } else if (spellSafety.recommendation === "risky") {
        priority -= 8;
      }

      actions.push({
        type: "spell",
        index,
        cardId: card.id,
        priority,
        cardName: card.name,
        macroBuff,
        safetyScore: spellSafety.riskScore,
        reason: decision.reason,
        activationContext: {
          ...activationContext,
          actionContext: buildLuminarchSpellActionContext(
            card,
            analysis,
            activationContext.actionContext,
          ),
        },
      });
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
        game.effectEngine?.canActivateSpellTrapEffectPreview &&
        typeof game.effectEngine.canActivateSpellTrapEffectPreview ===
          "function"
      ) {
        const preview = game.effectEngine.canActivateSpellTrapEffectPreview(
          card,
          bot,
          "spellTrap",
          null,
          { activationContext },
        );
        if (preview && preview.ok === false) return;
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

      let priority = decision.priority || 1;
      const macroBuff = calculateMacroPriorityBonus(
        "spell",
        card,
        macroStrategy,
      );
      priority += macroBuff;

      const spellSafety = assessActionSafety(
        { bot, player: opponent },
        bot,
        opponent,
        "spell",
        card,
      );
      if (spellSafety.recommendation === "very_risky") {
        priority -= 15;
      } else if (spellSafety.recommendation === "risky") {
        priority -= 8;
      }

      actions.push({
        type: "spellTrapEffect",
        index,
        zoneIndex: index,
        cardId: card.id,
        priority,
        cardName: card.name,
        macroBuff,
        safetyScore: spellSafety.riskScore,
        reason: decision.reason,
        activationContext: {
          ...activationContext,
          fromHand: false,
          activationZone: "spellTrap",
          sourceZone: "spellTrap",
          actionContext: buildLuminarchSpellActionContext(
            card,
            analysis,
            activationContext.actionContext,
          ),
        },
      });
    } catch (e) {
      // Silent spell/trap evaluation error
    }
  });

  return actions;
}

function getSetSpellTrapActions(context, spellIndicesActivated) {
  const { bot } = context;
  const actions = [];
  const canSetSpellTrap = (bot.spellTrap || []).length < 5;
  if (!canSetSpellTrap) return actions;

  const baseSetPriority = -1;
  bot.hand.forEach((card, index) => {
    if (!card) return;

    if (card.cardKind === "trap") {
      // OK
    } else if (card.cardKind === "spell" && card.subtype === "quick") {
      // OK
    } else {
      return;
    }

    if (spellIndicesActivated.has(index)) return;

    const valueEstimate = estimateCardValue(card, {
      archetype: "Luminarch",
      fieldSpell: bot?.fieldSpell || null,
      preferDefense: true,
    });
    const setPriority = baseSetPriority + valueEstimate * 0.2;

    actions.push({
      type: "set_spell_trap",
      index,
      cardId: card.id,
      priority: setPriority,
      cardName: card.name,
      reason: "setup_backrow",
    });
  });

  return actions;
}

export function getLuminarchSpellActions(context) {
  const spellIndicesActivated = new Set();
  return [
    ...getHandSpellActions(context, spellIndicesActivated),
    ...getSpellTrapEffectActions(context),
    ...getSetSpellTrapActions(context, spellIndicesActivated),
  ];
}
