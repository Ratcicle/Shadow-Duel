import type BaseStrategy from "../BaseStrategy.js";
import type { AIState } from "../../contracts/ai.js";
import type { GameCard } from "../../contracts/cards.js";
import type { StrategyCard, VoidPlayer, VoidGame, VoidAnalysisInput, VoidAnalysis, VoidCompleteAnalysis, VoidSwarmPayoffs, VoidMacroStrategy } from "./types.js";
import { buildStrategyAnalysis } from "../common/analysis.js";
import { ascensionMaterialMatches } from "../../game/summon/ascension.js";
import { getEffectiveStat, getStrongestAttackThreat, getStrongestBattleThreat } from "../common/cardStats.js";
import { isVoid } from "./knowledge.js";
import { VOID_IDS, detectAvailableCombos, calculateFusionValue } from "./combos.js";
import { evaluateVoidFinisherPlans } from "./priorities.js";
import { analyzeHollowEconomy, assessVoidHollowResourcePolicy } from "./scoring.js";

export interface VoidAnalysisHost extends Pick<BaseStrategy, "getOpponent"> {
  bot: VoidPlayer;
  thoughtProcess: string[];
  currentAnalysis: VoidCompleteAnalysis | null;
  analyzeSwarmPayoffs(analysis: Pick<VoidAnalysisInput, "hand" | "field" | "graveyard" | "extraDeck">): VoidSwarmPayoffs;
  decideMacroStrategy(analysis: VoidAnalysisInput): VoidMacroStrategy;
}

const MIRROR_DIMENSION_RANKS = new Map([
  [VOID_IDS.CONJURER, 100],
  [VOID_IDS.WALKER, 90],
  [VOID_IDS.TENEBRIS_HORN, 80],
  [VOID_IDS.BEAST, 70],
  [VOID_IDS.FORGOTTEN_KNIGHT, 100],
  [VOID_IDS.HAUNTER, 90],
  [VOID_IDS.THOUSAND_ARMS, 100],
  [VOID_IDS.SERPENT_DRAKE, 90],
  [VOID_IDS.BONE_SPIDER, 80],
  [VOID_IDS.SLAYER_BRUTE, 100],
  [VOID_IDS.ARCTURUS, 100],
]);

export function getOpponentStrongestBattleStat(analysis: VoidAnalysisInput = {}) {
  const fromAnalysis = Number(analysis.oppStrongestAtk || 0);
  if (fromAnalysis > 0) return fromAnalysis;
  return (analysis.oppField || []).reduce((max, card) => {
    if (!card || card.cardKind !== "monster") return max;
    if (card.isFacedown) return Math.max(max, 1500);
    return Math.max(max, getEffectiveStat(card, "atk"));
  }, 0);
}

function getArcturusSoloBuffState(player: VoidPlayer | null | undefined) {
  const faceUpMonsters = (player?.field || []).filter(
    (card) => card && card.cardKind === "monster" && !card.isFacedown,
  );
  const arcturus = faceUpMonsters.find(
    (card) => card?.id === VOID_IDS.ARCTURUS,
  );
  if (!arcturus) {
    return {
      arcturus: null,
      isSolo: false,
      voidsInGY: 0,
      soloBonus: 0,
      projectedAtk: 0,
    };
  }

  const voidsInGY = (player?.graveyard || []).filter(isVoid).length;
  const soloBonus = voidsInGY * 100;
  return {
    arcturus,
    isSolo: faceUpMonsters.length === 1,
    voidsInGY,
    soloBonus,
    projectedAtk: getEffectiveStat(arcturus, "atk") + soloBonus,
  };
}

export function shouldPreserveArcturusSoloBuff(player: VoidPlayer, opponent: VoidPlayer | null, analysis: VoidAnalysisInput = {}) {
  const state = getArcturusSoloBuffState(player);
  if (!state.isSolo || state.soloBonus <= 0) return false;

  const strongestThreat = getOpponentStrongestBattleStat(analysis);
  const opponentLP = opponent?.lp || analysis.oppLP || 8000;
  return (
    state.projectedAtk >= opponentLP ||
    state.projectedAtk > strongestThreat ||
    state.soloBonus >= 300
  );
}

export function getMirrorDimensionCandidateScore(card: StrategyCard | null | undefined) {
  if (!card || card.cardKind !== "monster") return -100;
  if (card.id === VOID_IDS.RAVEN) return -80;
  if (card.id === VOID_IDS.HOLLOW) return -25;
  if (MIRROR_DIMENSION_RANKS.has(card.id!)) {
    return MIRROR_DIMENSION_RANKS.get(card.id!)!;
  }
  if (isVoid(card) && (card.level || 0) >= 4) return 35;
  return 10;
}

function isUsefulMirrorDimensionHandMonster(card: StrategyCard) {
  return getMirrorDimensionCandidateScore(card) > 0;
}

function getLikelyOpponentSummonLevels(opponent: VoidPlayer | null | undefined) {
  const zones = [
    ...(opponent?.hand || []),
    ...(opponent?.extraDeck || []),
  ];
  return new Set(
    zones
      .filter((card) => card?.cardKind === "monster" && Number.isFinite(card.level))
      .map((card) => card.level),
  );
}

export function evaluateMirrorDimensionSetup(bot: VoidPlayer, opponent: VoidPlayer | null, mirrorCard: StrategyCard) {
  const usefulHandMonsters = (bot?.hand || []).filter(
    (candidate) =>
      candidate !== mirrorCard && isUsefulMirrorDimensionHandMonster(candidate),
  );
  if (usefulHandMonsters.length === 0) {
    return { ok: false, priority: 0, usefulHandMonsters: [] };
  }

  const likelyLevels = getLikelyOpponentSummonLevels(opponent);
  const matchingMonsters =
    likelyLevels.size > 0
      ? usefulHandMonsters.filter((candidate) =>
          likelyLevels.has(candidate.level),
        )
      : [];
  if (matchingMonsters.length === 0) {
    return { ok: false, priority: 0, usefulHandMonsters, matchingMonsters };
  }

  const highImpact = matchingMonsters.filter(
    (candidate) => getMirrorDimensionCandidateScore(candidate) >= 70,
  ).length;
  const priority =
    4.2 +
    Math.min(matchingMonsters.length, 3) * 0.25 +
    Math.min(highImpact, 2) * 0.45;

  return { ok: true, priority, usefulHandMonsters, matchingMonsters };
}

export function getMaterialEffectActivationCount(game: VoidGame | null | undefined, player: VoidPlayer | null | undefined, materialId: number | undefined) {
  const playerId = player?.id;
  if ((playerId !== "player" && playerId !== "bot") || materialId === undefined) return 0;
  return game?.materialDuelStats?.[playerId]?.effectActivationsByMaterialId.get(materialId) || 0;
}

function hasRequiredMaterialEffects(
  game: VoidGame | null | undefined,
  player: VoidPlayer,
  materialId: number | undefined,
  effectIds: readonly string[] | undefined,
): boolean {
  if (materialId === undefined || !effectIds?.length) return false;
  if (player.id !== "player" && player.id !== "bot") return false;
  // Planning snapshots own both inherited and newly simulated history.
  const stats = game?.materialDuelStats;
  const activated = stats?.[player.id]?.activatedEffectIdsByMaterialId?.get(materialId);
  return effectIds.every(id => activated?.has(id));
}

function hasRequiredDistinctEffects(game: VoidGame | null | undefined, player: VoidPlayer, ascension: StrategyCard): boolean {
  const requirements = ascension.ascension?.requirements?.filter(req => req.type === "material_effects_activated");
  return !!requirements?.length && requirements.every(req =>
    hasRequiredMaterialEffects(game, player, ascension.ascension?.materialId, req.effectIds));
}

export function isMaliciousAscensionReady(game: VoidGame | null | undefined, player: VoidPlayer | null | undefined, material: StrategyCard) {
  if (!game || !player || material?.id !== VOID_IDS.THOUSAND_ARMS) {
    return false;
  }
  const realGame = game._isPerspectiveState ? game : game._gameRef || game;
  const malicious = (player.extraDeck || []).find(
    (card) => card?.id === VOID_IDS.MALICIOUS_DEMON,
  );
  if (!malicious) return false;
  const materialCheck = realGame.canUseAsAscensionMaterial?.(player, material);
  if (materialCheck && materialCheck.ok === false) return false;
  const requirementCheck = realGame.checkAscensionRequirements?.(
    player,
    malicious,
  );
  return requirementCheck?.ok === true ||
    (requirementCheck === undefined && hasRequiredDistinctEffects(game, player, malicious));
}

export function getThousandArmsMaliciousSetup(game: VoidGame | null | undefined, player: VoidPlayer | null | undefined, material: StrategyCard) {
  if (!game || !player || material?.id !== VOID_IDS.THOUSAND_ARMS) {
    return {
      hasMalicious: false,
      activations: 0,
      requirementsMet: false,
      canAscendNow: false,
      shouldHoldForAscension: false,
      shouldDelayFreshBounce: false,
    };
  }

  const realGame = game._isPerspectiveState ? game : game._gameRef || game;
  const malicious = (player.extraDeck || []).find(
    (card) => card?.id === VOID_IDS.MALICIOUS_DEMON,
  );
  const activations = getMaterialEffectActivationCount(
    realGame,
    player,
    VOID_IDS.THOUSAND_ARMS,
  );

  if (!malicious) {
    return {
      hasMalicious: false,
      activations,
      requirementsMet: false,
      canAscendNow: false,
      shouldHoldForAscension: false,
      shouldDelayFreshBounce: false,
    };
  }

  const requirementCheck = realGame.checkAscensionRequirements?.(
    player,
    malicious,
  );
  const requirementsMet =
    requirementCheck?.ok === true ||
    (typeof requirementCheck?.ok !== "boolean" && hasRequiredDistinctEffects(game, player, malicious));
  const materialCheck = realGame.canUseAsAscensionMaterial?.(player, material);
  const canAscendNow =
    requirementsMet && (materialCheck?.ok !== false || !materialCheck);
  const onField = (player.field || []).includes(material);
  const tooFreshForAscension =
    materialCheck?.ok === false &&
    String(materialCheck.reason || "").includes("at least 1 turn");

  return {
    hasMalicious: true,
    activations,
    requirementsMet,
    canAscendNow,
    tooFreshForAscension,
    shouldHoldForAscension:
      onField && requirementsMet && (canAscendNow || tooFreshForAscension),
    shouldDelayFreshBounce: onField && !requirementsMet && tooFreshForAscension,
  };
}

export function getSimulatedVoidAscensionCandidates(game: VoidGame, player: VoidPlayer, material: StrategyCard) {
  if (!player || !material || material.cardKind !== "monster" || material.isFacedown) {
    return [];
  }
  return (player.extraDeck || []).filter((candidate) => {
    if (!candidate || candidate.monsterType !== "ascension") return false;
    if (!ascensionMaterialMatches(candidate as GameCard, material as GameCard, game?.effectEngine as Parameters<typeof ascensionMaterialMatches>[2])) {
      return false;
    }
    const requirements = candidate.ascension?.requirements || [];
    return requirements.every((requirement) => {
      if (requirement?.type === "material_effects_activated") {
        return hasRequiredMaterialEffects(game, player, material.id, requirement.effectIds);
      }
      if (requirement?.type !== "material_effect_activations") return true;
      const required = Number(requirement.count || 0);
      return getMaterialEffectActivationCount(game, player, material.id) >= required;
    });
  });
}

export function analyzeVoidGameState(this: VoidAnalysisHost, gameInput: AIState): VoidCompleteAnalysis {
    const game = gameInput as VoidGame;
    this.thoughtProcess = [];
    const isSimulatedState = game._isPerspectiveState === true;
    const bot = isSimulatedState ? game.bot : this.bot || game.bot;
    const opponent = this.getOpponent(game, bot);

    const basic = buildStrategyAnalysis({ bot, opponent });
    const analysis: VoidAnalysis = {
      // Recursos próprios
      hand: basic.hand,
      deck: basic.deck,
      field: basic.field,
      graveyard: basic.graveyard,
      extraDeck: basic.extraDeck,
      spellTrap: basic.spellTrap,
      fieldSpell: bot.fieldSpell,
      lp: basic.lp,
      bot,
      opponent,
      phase: game?.phase,
      summonAvailable: basic.summonAvailable,

      // Recursos do oponente
      oppField: basic.oppField,
      oppHand: basic.oppHand,
      oppGraveyard: basic.oppGraveyard,
      oppSpellTrap: basic.oppSpellTrap,
      oppFieldSpell: opponent?.fieldSpell,
      oppLP: basic.oppLP,

      // Métricas calculadas
      oppFieldCount: (opponent?.field || []).length,
      oppStrongestAtk: getStrongestAttackThreat(basic.oppField, { facedownValue: 1500 }),
      oppStrongestBattle: getStrongestBattleThreat(basic.oppField, { facedownValue: 1500 }),
      myStrongestAtk: getStrongestAttackThreat(basic.field, { facedownValue: "printed" }),
      hollowCount: (bot.field || []).filter((m) => m?.id === VOID_IDS.HOLLOW)
        .length,
      voidCount: (bot.field || []).filter(isVoid).length,
      hollowsInHand: (bot.hand || []).filter((m) => m?.id === VOID_IDS.HOLLOW)
        .length,
      myLP: bot.lp || 8000,
    };

    // Detectar combos disponíveis
    analysis.availableCombos = detectAvailableCombos(analysis);
    analysis.readyCombos = analysis.availableCombos.filter((c) => c.ready);

    // Analisar economia de Hollows (campo, mão, GY, acessibilidade)
    analysis.hollowEconomy = analyzeHollowEconomy(analysis);

    // Analisar payoffs disponíveis para swarm
    analysis.swarmPayoffs = this.analyzeSwarmPayoffs(analysis);
    analysis.finisherPlans = evaluateVoidFinisherPlans(
      bot,
      opponent,
      game,
      analysis,
    );
    analysis.bestFinisherPlan = analysis.finisherPlans[0] || null;
    analysis.hollowResourcePolicy = assessVoidHollowResourcePolicy(analysis);

    // Determinar estratégia macro
    analysis.macroStrategy = this.decideMacroStrategy(analysis);

    this.currentAnalysis = analysis as VoidCompleteAnalysis;
    return analysis as VoidCompleteAnalysis;
  }

export function analyzeVoidSwarmPayoffs(analysis: Pick<VoidAnalysisInput, "hand" | "field" | "graveyard" | "extraDeck">): VoidSwarmPayoffs {
    const { hand, field, graveyard, extraDeck } = analysis;
    const handIds = (hand || []).map((c) => c?.id).filter(Boolean);
    const gyIds = (graveyard || []).map((c) => c?.id).filter(Boolean);
    const extraIds = (extraDeck || []).map((c) => c?.id).filter(Boolean);
    const hollowsOnField = (field || []).filter(
      (m) => m?.id === VOID_IDS.HOLLOW && !m.isFacedown,
    ).length;
    const hollowsInHand = handIds.filter((id) => id === VOID_IDS.HOLLOW).length;
    const hollowsInGY = gyIds.filter((id) => id === VOID_IDS.HOLLOW).length;
    const hollowsFieldAndGY = hollowsOnField + hollowsInGY;
    const voidCountTotal =
      (hand || []).filter(isVoid).length + (field || []).filter(isVoid).length;

    const payoffs = {
      hasBossPayoff: false, // Tem boss para tributar Hollows
      hasFusionPayoff: false, // Pode fazer fusão com Hollows
      hasGYPayoff: false, // Pode usar Hollows no GY (Haunter revive)
      totalPayoffValue: 0,
      reasons: [] as string[],
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // BOSS PAYOFFS: Monstros que tributam Hollows/Voids
    // ═══════════════════════════════════════════════════════════════════════════

    // Haunter (tributa 1 Hollow → 2100 ATK, pode reviver 3 depois)
    if (handIds.includes(VOID_IDS.HAUNTER)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 3.5;
      payoffs.reasons.push("Haunter pode tributar Hollow e reviver depois");
    }

    // Slayer Brute (tributa 2 Voids → 2500 ATK; banish se usar Hollow)
    if (handIds.includes(VOID_IDS.SLAYER_BRUTE)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 4.0;
      payoffs.reasons.push("Slayer Brute pode tributar 2 Voids");
    }

    // Serpent Drake (envia 1 Hollow → 2300 ATK com proteção)
    if (handIds.includes(VOID_IDS.SERPENT_DRAKE)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 3.5;
      payoffs.reasons.push("Serpent Drake usa Hollow para pressão protegida");
    }

    // Forgotten Knight (tributa 1 Void → 2000 ATK)
    if (handIds.includes(VOID_IDS.FORGOTTEN_KNIGHT)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 2.0;
      payoffs.reasons.push("Forgotten Knight pode tributar Void");
    }

    // Thousand-Arms (tributa 1 Void → 2100 ATK + bounce-revive 2 Hollows do GY)
    if (handIds.includes(VOID_IDS.THOUSAND_ARMS)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 3.5;
      payoffs.reasons.push(
        "Thousand-Arms tributa Void e habilita bounce-revive de Hollows do GY",
      );
    }

    // Arcturus (2 tributos → 2800 ATK + lock de BP + scaling com Voids no GY)
    if (handIds.includes(VOID_IDS.ARCTURUS)) {
      payoffs.hasBossPayoff = true;
      payoffs.totalPayoffValue += 5.0;
      payoffs.reasons.push(
        "Arcturus Lord of the Void: 2800 ATK + lock de Battle Phase + GY scaling",
      );
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FUSION PAYOFFS
    // ═══════════════════════════════════════════════════════════════════════════
    const hasPoly = handIds.includes(VOID_IDS.POLYMERIZATION);

    // Hollow King (3 Hollows)
    if (hasPoly && extraIds.includes(VOID_IDS.HOLLOW_KING)) {
      const potentialHollows = hollowsOnField + hollowsInHand + 2; // +2 do combo
      if (potentialHollows >= 3) {
        payoffs.hasFusionPayoff = true;
        payoffs.totalPayoffValue += 4.5;
        payoffs.reasons.push("Hollow King fusion possível");
      }
    }

    // Hydra Titan (6 Voids)
    if (hasPoly && extraIds.includes(VOID_IDS.HYDRA_TITAN)) {
      const potentialVoids = voidCountTotal + 2; // +2 do combo (Hollows extras)
      if (potentialVoids >= 5) {
        // Quase lá
        payoffs.hasFusionPayoff = true;
        payoffs.totalPayoffValue += 5.0;
        payoffs.reasons.push("Hydra Titan fusion próxima");
      }
    }

    // Berserker (Slayer no campo + Void) - precisa Slayer primeiro
    if (hasPoly && extraIds.includes(VOID_IDS.BERSERKER)) {
      if (handIds.includes(VOID_IDS.SLAYER_BRUTE)) {
        payoffs.hasFusionPayoff = true;
        payoffs.totalPayoffValue += 4.0;
        payoffs.reasons.push("Berserker fusion via Slayer");
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GY PAYOFFS: Hollows no cemitério são recurso
    // ═══════════════════════════════════════════════════════════════════════════

    // Haunter no GY pode reviver até 3 Hollows
    if (gyIds.includes(VOID_IDS.HAUNTER) && hollowsInGY >= 1) {
      payoffs.hasGYPayoff = true;
      payoffs.totalPayoffValue += 2.0;
      payoffs.reasons.push("Haunter no GY pode reviver Hollows");
    }

    // Conjurer no GY pode se reviver (tributa Void do campo)
    if (gyIds.includes(VOID_IDS.CONJURER)) {
      payoffs.hasGYPayoff = true;
      payoffs.totalPayoffValue += 1.5;
      payoffs.reasons.push("Conjurer pode se reviver do GY");
    }

    // Tenebris Horn no GY pode se reviver se houver 2+ Hollows no campo/GY.
    if (gyIds.includes(VOID_IDS.TENEBRIS_HORN) && hollowsFieldAndGY >= 2) {
      payoffs.hasGYPayoff = true;
      payoffs.totalPayoffValue += 1.0;
      payoffs.reasons.push("Tenebris Horn pode se reviver");
    }

    return payoffs;
  }

export function decideVoidMacroStrategy(analysis: VoidAnalysisInput): VoidMacroStrategy {
    const {
      myLP,
      oppLP,
      oppFieldCount,
      oppStrongestAtk,
      voidCount,
      readyCombos,
      swarmPayoffs,
      hollowEconomy,
    } = analysis;

    // Check lethal
    const myTotalAtk = (analysis.field || [])
      .filter((m) => m?.position === "attack" && !m?.hasAttacked)
      .reduce((sum, m) => sum + (m?.atk || 0), 0);

    if (oppFieldCount === 0 && myTotalAtk >= oppLP!) {
      return { mode: "lethal", priority: 15 };
    }

    // Check danger
    if (myLP! <= 2000) {
      return { mode: "defensive", priority: 10 };
    }

    // Check se precisa de recovery (Hollows perdidos no GY)
    if (hollowEconomy?.needsRecovery && !hollowEconomy?.hasHaunterRevive) {
      // Priorizar buscar Haunter ou The Void
      return {
        mode: "recovery",
        priority: 9,
        reason: "Hollows stranded in GY",
      };
    }

    // Check fusion opportunity
    const fusionCombo = readyCombos!.find((c) => c.combo?.fusion);
    if (fusionCombo) {
      return { mode: "fusion", priority: 12, target: fusionCombo };
    }

    // Check swarm opportunity — MAS SÓ SE TEM PAYOFF!
    // Void é deck agressivo, swarm sem payoff = campo fraco que será destruído
    const swarmCombo = readyCombos!.find(
      (c) =>
        c.combo?.name?.includes("Conjurer") ||
        c.combo?.name?.includes("Pipeline"),
    );

    if (swarmCombo && voidCount! < 3) {
      const hasPayoff =
        swarmPayoffs?.hasBossPayoff ||
        swarmPayoffs?.hasFusionPayoff ||
        swarmPayoffs?.totalPayoffValue! >= 2.0;

      if (hasPayoff) {
        return {
          mode: "swarm",
          priority: 10 + (swarmPayoffs?.totalPayoffValue || 0) / 2,
          target: swarmCombo,
          payoffs: swarmPayoffs,
        };
      }
    }

    // Sem payoff claro, ser mais conservador
    // Pode invocar monstros individualmente mas não priorizar combo completo
    return { mode: "buildup", priority: 5 };
  }

export function calculateVoidComboBoosts(analysis: VoidAnalysisInput) {
    const boosts: Partial<Record<number, number>> = {};
    const readyCombos = analysis.readyCombos || [];

    for (const comboInfo of readyCombos) {
      const combo = comboInfo.combo;
      if (!combo) continue;

      // Boost para cartas que iniciam o combo
      if (combo.sequence && combo.sequence.length > 0) {
        const firstStep = combo.sequence[0];
        if (firstStep?.cardId) {
          boosts[firstStep.cardId] =
            (boosts[firstStep.cardId] || 0) + combo.priority / 5;
        }
      }

      // Boost para materiais de fusão
      if (combo.fusion) {
        for (const materialId of combo.fusion.materials || []) {
          if (typeof materialId === "number") {
            boosts[materialId] = (boosts[materialId] || 0) + 0.5;
          }
        }
      }
    }

    return boosts;
  }

export function evaluateVoidFusionOpportunity(analysis: VoidAnalysisInput) {
    const readyCombos = analysis.readyCombos || [];
    const fusionCombos = readyCombos.filter((c) => c.combo?.fusion);

    if (fusionCombos.length === 0) return 0;

    // Pegar a melhor fusão disponível
    const best = fusionCombos[0];
    const fusion = best?.combo?.fusion;
    return fusion ? calculateFusionValue(fusion.target, analysis) : 0;
  }
