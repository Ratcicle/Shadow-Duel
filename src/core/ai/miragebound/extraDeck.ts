import type { MirageboundAnalysis, MirageboundCard, MirageboundGame, MirageboundPlayer } from "./contracts.js";
import { MB, getCardInstanceIds, getBattleStat, getEffectiveAtk, getMaterialEffectActivations, hasCardStatus, isFaceUpMirageboundMonster, isMiragebound, isSimulatedState } from "./knowledge.js";
import { buildMirageboundActivationContext } from "./targeting.js";
import type { AIAction, AIState, AIStrategyBotPort } from "../../contracts/ai.js";
import { getGenericAscensionActions } from "../common/ascensionPlanning.js";
import { getGenericExtraDeckProcedureActions } from "../common/actionGeneration.js";

import type MirageboundStrategy from "../MirageboundStrategy.js";

export function getDesertLeviathanCard(bot: MirageboundPlayer) {
  return (bot?.extraDeck || []).find((card) => card?.name === MB.DESERT_LEVIATHAN);
}

export function getGlassSovereignCard(bot: MirageboundPlayer) {
  return (bot?.extraDeck || []).find((card) => card?.name === MB.GLASS_SOVEREIGN);
}

export function getLocalLeviathanMaterialCombos(bot: MirageboundPlayer) {
  const field = bot?.field || [];
  const vipers = field.filter(
    (card) => isFaceUpMirageboundMonster(card) && card.name === MB.GLASS_VIPER,
  );
  const combos: MirageboundCard[][] = [];
  for (const viper of vipers) {
    for (const other of field) {
      if (other === viper || !isFaceUpMirageboundMonster(other)) continue;
      combos.push([viper, other]);
    }
  }
  return combos;
}

export function getLeviathanMaterialCombos(game: MirageboundGame, bot: MirageboundPlayer, leviathan: MirageboundCard | undefined) {
  if (!leviathan) return { ok: false, combos: [], check: null };
  if (typeof game?.canSummonExtraDeckCardByProcedure === "function") {
    const check = game.canSummonExtraDeckCardByProcedure(leviathan, bot, {
      silent: true,
    });
    return {
      ok: !!check?.ok,
      combos: Array.isArray(check?.materialCombos)
        ? check.materialCombos
        : check?.ok
          ? getLocalLeviathanMaterialCombos(bot)
          : [],
      check,
    };
  }
  const combos = getLocalLeviathanMaterialCombos(bot);
  return { ok: combos.length > 0, combos, check: null };
}

export function getLeviathanSecondMaterialScore(card: MirageboundCard, analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  if (!card) return -100;
  const preferred: Record<string,number> = {
    [MB.DANCER]: 9,
    [MB.JACKAL]: 8,
    [MB.SAND_PRIESTESS]: 7,
    [MB.FALSE_KING]: 6,
    [MB.REBEL]: 5,
    [MB.GLASS_VIPER]: -8,
    [MB.GLASS_SOVEREIGN]: -12,
    [MB.DESERT_LEVIATHAN]: -12,
  };
  let score = preferred[card.name!] ?? (isMiragebound(card) ? 3 : -5);
  if (card.name === MB.SCOUT) {
    score = analysis.scoutReadyForAscension ? -18 : analysis.scoutNearAscension ? -10 : 2;
  }
  return score;
}

export function evaluateLeviathanCombo(combo: MirageboundCard[] = [], analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  const [viper, second] = combo;
  if (!viper || viper.name !== MB.GLASS_VIPER || !second) {
    return { viable: false, score: -100, reason: "invalid Leviathan materials" };
  }

  const opponentCount = (analysis.opponentMonsters || []).length;
  const attackTargets = (analysis.opponentAttackPositionMonsters || []).length;
  const wideBoard = opponentCount >= 2;
  const lethalSwing =
    analysis.oppPressure ||
    (analysis.readyAttackers || []).reduce(
      (sum, card) => sum + Math.max(0, getEffectiveAtk(card)),
      0,
    ) >= Number(analysis.oppLP || analysis.opponent?.lp || 8000);
  let score =
    7 +
    getLeviathanSecondMaterialScore(second, analysis) +
    Math.min(4, opponentCount) * 2 +
    attackTargets * 1.2;

  if (wideBoard) score += 7;
  if (analysis.oppPressure) score += 4;
  if (lethalSwing) score += 3;
  if (analysis.hasOasisActive) score += 1.2;
  if (opponentCount <= 1) score -= 7;
  if (opponentCount === 0) score -= 12;
  if (second.name === MB.SCOUT && analysis.scoutReadyForAscension && !wideBoard && !lethalSwing) {
    score -= 12;
  } else if (second.name === MB.SCOUT && analysis.scoutNearAscension && !wideBoard) {
    score -= 6;
  }
  if (hasCardStatus(viper, "banishWhenLeavesField") && analysis.hasMeaningfulBounce) {
    score -= 3;
  }

  const viable =
    opponentCount > 0 &&
    (score >= 9 || wideBoard || analysis.oppPressure || lethalSwing);
  return {
    viable,
    score,
    reason: wideBoard
      ? "Desert Leviathan punishes a wide board"
      : analysis.oppPressure
        ? "Desert Leviathan stabilizes battle pressure"
        : "Desert Leviathan converts Extra Deck pressure",
  };
}

export function chooseBestLeviathanCombo(combos: MirageboundCard[][] = [], analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  return combos
    .map((combo) => ({
      combo,
      evaluation: evaluateLeviathanCombo(combo, analysis),
    }))
    .filter((entry) => entry.evaluation.viable)
    .sort((a, b) => b.evaluation.score - a.evaluation.score)[0] || null;
}

type GetExtraDeckActionsPort = Pick<MirageboundStrategy, "chooseAutomaticAscensionPosition">;

export function getExtraDeckActions(strategy: GetExtraDeckActionsPort, game: MirageboundGame, bot: MirageboundPlayer, analysis: MirageboundAnalysis) {
  const actions: AIAction[] = [];
  const simulated = isSimulatedState(game);
  const sovereign = getGlassSovereignCard(bot);

  actions.push(
    ...getGenericAscensionActions(
      {
        game,
        bot,
        opponent: analysis.opponent,
        analysis,
        isSimulatedState: simulated,
      },
      {
        getSimulatedAscensionCandidates: (_game, player, material) => {
          if (material?.name !== MB.SCOUT) return [];
          if (getMaterialEffectActivations(_game, player, 351) < 2) return [];
          return sovereign ? [sovereign] : [];
        },
        shouldSkipAscension: (ascensionCard) =>
          ascensionCard?.name !== MB.GLASS_SOVEREIGN,
        evaluateAscensionPriority: () =>
          12.5 +
          (analysis.opponentMonsters.length <= 1 ? 2.2 : 0) +
          (analysis.oppPressure ? 1.2 : 0),
        chooseAscensionPosition: (ascensionCard, material) =>
          strategy.chooseAutomaticAscensionPosition({
            ascensionCard,
            material,
            game,
            bot,
            opponent: analysis.opponent,
          }),
        decorateAction: (action, ascensionCard, material) => ({
          ...action,
          cardId: ascensionCard?.id,
          materialId: material?.id,
          materialName: material?.name,
          reason: "Glass Sovereign Ascension line",
          activationContext: buildMirageboundActivationContext(
            ascensionCard,
            analysis,
            {
              zone: "extraDeck",
              activationZone: "extraDeck",
              sourceZone: "extraDeck",
            },
          ),
        }),
      },
    ),
  );

  const leviathan = getDesertLeviathanCard(bot);
  actions.push(...getGenericExtraDeckProcedureActions(
    bot, leviathan ? [{ card: leviathan, sourceIndex: bot.extraDeck.indexOf(leviathan) }] : [], {
      game,
      getMaterialCombos: () => getLeviathanMaterialCombos(game, bot, leviathan),
      selectMaterials: combos => chooseBestLeviathanCombo(combos.map(combo => combo.slice()), analysis),
      getActionDetails: (selected, entry) => ({
        position: "attack",
        priority: Math.min(15, Math.max(6, selected.evaluation.score || 8)),
        reason: selected.evaluation.reason || "Extra Deck contact fusion",
        activationContext: buildMirageboundActivationContext(entry.card, analysis, {
          zone: "extraDeck", activationZone: "extraDeck", sourceZone: "extraDeck",
        }),
      }),
      getMaterialInstanceIds: getCardInstanceIds,
    },
  ));

  return actions;
}

type SelectAutomaticAscensionPort = Pick<MirageboundStrategy, "bot" | "chooseAutomaticAscensionPosition">;

export function selectAutomaticAscension<Card extends MirageboundCard | import("../../contracts/cards.js").GameCard>(strategy: SelectAutomaticAscensionPort, { choices = [], game, bot = strategy.bot, opponent }: {choices?:Array<{ascensionCard:Card;material:Card;position?:import("../../contracts/cards.js").BattlePositionInput|undefined}>;bot?:AIStrategyBotPort;game?:AIState;opponent?:AIStrategyBotPort|null} = {}) {
  const sovereignChoice = choices.find(
    (choice) => choice?.ascensionCard?.name === MB.GLASS_SOVEREIGN,
  );
  if (!sovereignChoice) return null;

  return {
    material: sovereignChoice.material,
    ascensionCard: sovereignChoice.ascensionCard,
    position: strategy.chooseAutomaticAscensionPosition({
      material: sovereignChoice.material,
      ascensionCard: sovereignChoice.ascensionCard,
      game,
      bot,
      opponent,
    }),
  };
}

export function shouldUseAutomaticAscensionShortcut() {
  return false;
}

type ChooseAutomaticAscensionPositionPort = Pick<MirageboundStrategy, "bot" | "getOpponent">;

export function chooseAutomaticAscensionPosition(strategy: ChooseAutomaticAscensionPositionPort, { ascensionCard, game, bot = strategy.bot, opponent }: {ascensionCard?:MirageboundCard | import("../../contracts/cards.js").GameCard;bot?:AIStrategyBotPort;opponent?:AIStrategyBotPort|null | undefined;game?:AIState | undefined;material?:MirageboundCard | import("../../contracts/cards.js").GameCard} = {}) {
  if (ascensionCard?.name !== MB.GLASS_SOVEREIGN) {
    return ascensionCard?.ascension?.position || "choice";
  }

  const resolvedOpponent =
    opponent || (game && bot ? strategy.getOpponent(game, bot) : null);
  const strongest = (resolvedOpponent?.field || []).reduce(
    (max, monster) => Math.max(max, getBattleStat(monster)),
    0,
  );
  if ((bot?.lp || 8000) <= 2000 && strongest >= (ascensionCard.def || 0)) {
    return "defense";
  }
  return "attack";
}
