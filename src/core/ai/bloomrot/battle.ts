import type { BloomrotCard, BloomrotPlayer, BloomrotAnalysis, BloomrotPlanningGame } from "./analysis.js";
import type { AIPlanningProfile } from "../../contracts/ai.js";
import type { EffectDefinition } from "../../contracts/effects.js";
import type { SimulatedCardState } from "../../contracts/aiState.js";
import type { SimulatedActionOptions, SimulatedRuntimeState } from "../common/simulatedActions/shared.js";
import { emitSimulatedBattleDamage, emitSimulatedBattleDestroy } from "../common/simulation.js";
import { findCardOwner } from "../common/zones.js";
type BattleSummary = { damage?: number; destroyedCards?: Array<{ owner?: string; cardKind?: string | undefined;
  card?: SimulatedCardState; destroyedBy?: string; position?: string | null }> };
type BattleContext = { attacker?: BloomrotCard | null; target?: BloomrotCard | null; lethalNow?: boolean; attackerSurvived?: boolean; targetSurvived?: boolean; summary?: BattleSummary; opponent?: BloomrotPlayer; opponentLpAfter?: number; game?: BloomrotPlanningGame;
  state?: SimulatedRuntimeState; options?: SimulatedActionOptions; battlePlan?: { attackerCard?: BloomrotCard | null } };
import {
  getBattleStatForAttackTarget,
  getEffectiveAtk,
  getEffectiveDef,
} from "../common/cardStats.js";
import {
  BLOOMROT_NAMES,
  getSporeCount,
  isBloomrotMonster,
} from "./analysis.js";

const N = {
  ROT_STAG: "Bloomrot Rot-Stag",
  CARRIONCAP: "Bloomrot Carrioncap",
  GRAVECAP_WIDOW: "Bloomrot Gravecap Widow",
  ANCIENT_HUSK: "Bloomrot Ancient Husk",
  DEVOURER: BLOOMROT_NAMES.DEVOURER,
  QUEEN: BLOOMROT_NAMES.QUEEN,
};

const KEY_PIECES = new Set([
  N.GRAVECAP_WIDOW,
  N.ANCIENT_HUSK,
  N.DEVOURER,
  N.QUEEN,
]);

const DEFAULT_PROFILE = Object.freeze<AIPlanningProfile>({
  enabled: false,
  mode: "off",
  turnMode: "mainOnly",
  beamWidth: 3,
  maxDepth: 4,
  nodeBudget: 220,
  candidateLimit: 8,
  battleStepLimit: 1,
});

function asArray<Value>(value: readonly Value[] | null | undefined): Value[] {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function isFaceupMonster(card: BloomrotCard | null | undefined): card is BloomrotCard {
  return card?.cardKind === "monster" && card.isFacedown !== true;
}

function isBloomrotToken(card: BloomrotCard | null | undefined) {
  return card?.isToken === true || card?.name === BLOOMROT_NAMES.TOKEN;
}

function canAttack(card: BloomrotCard | null | undefined) {
  return (
    isFaceupMonster(card) &&
    !isBloomrotToken(card) &&
    card.position === "attack" &&
    card.cannotAttackThisTurn !== true &&
    card.hasAttacked !== true
  );
}

function battleAtk(attacker: BloomrotCard | null | undefined, target: BloomrotCard | null | undefined = null, state?: SimulatedRuntimeState) {
  let atk = getEffectiveAtk(attacker);
  if (
    attacker?.name === N.ROT_STAG &&
    target?.cardKind === "monster" &&
    getSporeCount(target) > 0 &&
    !state?.damageCalculationTempBuffs?.some(buff => buff.card === attacker && Number(buff.atk || 0) > 0)
  ) {
    atk += 500;
  }
  return atk;
}

function battleStat(target: BloomrotCard | null | undefined) {
  return getBattleStatForAttackTarget(target, { facedownValue: 1500 });
}

function cardThreat(card: BloomrotCard | null | undefined) {
  if (!card) return 0;
  if (card.cardKind !== "monster") return 0;
  return (
    Math.max(getEffectiveAtk(card), getEffectiveDef(card)) +
    Number(card.level || 0) * 120 +
    getSporeCount(card) * 180
  );
}

function targetIsMarked(target: BloomrotCard | null | undefined) {
  return target?.cardKind === "monster" && getSporeCount(target) > 0;
}

function wouldDestroy(attacker: BloomrotCard | null | undefined, target: BloomrotCard | null | undefined) {
  if (!attacker || !target) return false;
  return battleAtk(attacker, target) > battleStat(target);
}

function wouldSurvive(attacker: BloomrotCard | null | undefined, target: BloomrotCard | null | undefined) {
  if (!attacker || !target) return true;
  if (target.position === "defense") {
    return battleAtk(attacker, target) >= battleStat(target);
  }
  return battleAtk(attacker, target) > battleStat(target);
}

function directLethalAvailable(attackers: BloomrotCard[] = [], opponent: BloomrotPlayer = {}) {
  if (asArray(opponent.field).some((card) => card?.cardKind === "monster")) {
    return false;
  }
  const lp = Number(opponent.lp || 0);
  return attackers.some((attacker) => battleAtk(attacker, null) >= lp && lp > 0);
}

function hasTemporaryBattleStats(card: BloomrotCard | null | undefined) {
  return (
    Number(card?.tempAtkBoost || 0) !== 0 ||
    Number(card?.tempDefBoost || 0) !== 0 ||
    Boolean(card?.dynamicBuffs)
  );
}

function hasMeaningfulBattleSignal(analysis: BloomrotAnalysis = {}) {
  const attackers = asArray(analysis.faceUpBloomrotField).filter(canAttack);
  if (attackers.length === 0) return false;
  const opponent = analysis.opponent || {};
  const opponentMonsters = asArray(analysis.opponentMonsters);

  if (directLethalAvailable(attackers, opponent)) return true;
  if (attackers.some(hasTemporaryBattleStats)) return true;
  if (attackers.some((card) => [N.CARRIONCAP, N.DEVOURER].includes(card.name!))) {
    if (opponentMonsters.some(targetIsMarked)) return true;
  }
  if (
    attackers.some((attacker) =>
      opponentMonsters.some(
        (target) => targetIsMarked(target) && wouldDestroy(attacker, target),
      ),
    )
  ) {
    return true;
  }

  return false;
}

export function buildBloomrotPlanningProfile(analysis: BloomrotAnalysis = {}, context: Pick<BattleContext, "game"> = {}): AIPlanningProfile & { reasons: string[]; critical: boolean } {
  const game = context.game || analysis.game || {};
  const manual = game?.turnLineSearchEnabled === true;
  const phase = String(analysis.phase || game.phase || "main1").toLowerCase();
  const battleSignal = phase.includes("main1") && hasMeaningfulBattleSignal(analysis);
  const enabled = manual || battleSignal;
  const requestedTurnMode = game?.turnLineSearchTurnMode;
  const reasons = [];
  if (battleSignal) reasons.push("Bloomrot battle payoff available");

  return {
    ...DEFAULT_PROFILE,
    enabled,
    mode: manual && !battleSignal ? "manual" : enabled ? "critical" : "off",
    turnMode: requestedTurnMode || (battleSignal ? "mainBattleMain2" : "mainOnly"),
    beamWidth: Number.isFinite(game?.turnLineSearchBeamWidth)
      ? game.turnLineSearchBeamWidth!
      : DEFAULT_PROFILE.beamWidth,
    maxDepth: Number.isFinite(game?.turnLineSearchMaxDepth)
      ? game.turnLineSearchMaxDepth!
      : DEFAULT_PROFILE.maxDepth,
    nodeBudget: Number.isFinite(game?.turnLineSearchNodeBudget)
      ? game.turnLineSearchNodeBudget!
      : DEFAULT_PROFILE.nodeBudget,
    candidateLimit: Number.isFinite(game?.turnLineSearchCandidateLimit)
      ? game.turnLineSearchCandidateLimit!
      : DEFAULT_PROFILE.candidateLimit,
    battleStepLimit: Number.isFinite(game?.turnLineSearchBattleStepLimit)
      ? game.turnLineSearchBattleStepLimit!
      : DEFAULT_PROFILE.battleStepLimit,
    reasons,
    critical: battleSignal,
  };
}

function scopedBloomrotEffects(card: SimulatedCardState, event: "battle_damage" | "battle_destroy"): EffectDefinition[] {
  if (!isBloomrotMonster(card) || isBloomrotToken(card)) return [];
  return card.effects?.filter(effect => effect.timing === "on_event" && effect.event === event &&
    !!effect.actions?.length && effect.actions.every(action => event === "battle_damage"
      ? action.type === "buff_stats_temp" && action.duration === "damage_calculation"
      : action.type === "optional_target_actions" && action.actions?.every(nested => nested.type === "add_counter"))) || [];
}

export function prepareBloomrotSimulatedBattle({ state, attacker, target, options = {} }: BattleContext = {}): string[] {
  if (!state || !attacker || !target) return [];
  const physicalAttacker = [state.bot, state.player].flatMap(player => player.field).find(card => card === attacker);
  const physicalTarget = [state.bot, state.player].flatMap(player => player.field).find(card => card === target);
  if (!physicalAttacker || !physicalTarget) return [];
  const attackerOwner = findCardOwner(state, physicalAttacker), defenderOwner = findCardOwner(state, physicalTarget);
  if (!attackerOwner || !defenderOwner || attackerOwner === defenderOwner) return [];
  const sources = [physicalAttacker, physicalTarget];
  const effects = sources.flatMap(card => scopedBloomrotEffects(card, "battle_damage"));
  const before = sources.map(card => Number(card.atk || 0));
  if (effects.length) emitSimulatedBattleDamage(state, { attacker: physicalAttacker, defender: physicalTarget,
    target: physicalTarget, attackerOwner, defenderOwner, recordNegatedBattleActivation: true }, options, sources, effects);
  return Number(physicalAttacker.atk || 0) > before[0]!
    ? ["Rot-Stag +500 vs spored monster"] : [];
}

function bestSporeRewardTarget(opponent: BloomrotPlayer = {}) {
  return asArray(opponent.field)
    .filter((card) => isFaceupMonster(card))
    .sort((a, b) => cardThreat(b) - cardThreat(a))[0] || null;
}

export function applyBloomrotSimulatedBattleRewards({ state, battlePlan, summary, opponent, options = {} }: BattleContext = {}): string[] {
  const attacker = battlePlan?.attackerCard;
  if (!state || !attacker) return [];
  const source = [state.bot, state.player].flatMap(player => player.field).find(card => card === attacker);
  if (!source) return [];
  const effects = scopedBloomrotEffects(source, "battle_destroy");
  if (!effects.length) return [];
  const owner = findCardOwner(state, source);
  if (!owner) return [];
  const other = owner === state.bot ? state.player : state.bot;
  const target = bestSporeRewardTarget(opponent || other);
  const targetDefinitions = effects.flatMap(effect => effect.actions?.flatMap(action =>
    action.type === "optional_target_actions" ? action.targets || [] : []) || []);
  const preferences = target?.instanceId == null ? {} : Object.fromEntries(targetDefinitions.map(definition =>
    [definition.id, { preferredInstanceIds: [target.instanceId] }]));
  const rewardOptions: SimulatedActionOptions = { ...options, actionContext: { ...options.actionContext,
    targetPreferences: { ...preferences, ...options.actionContext?.targetPreferences } } };
  const recipients = [...other.field, ...other.spellTrap, ...(other.fieldSpell ? [other.fieldSpell] : [])];
  const before = recipients.map(card => getSporeCount(card));
  for (const entry of summary?.destroyedCards || []) {
    if (!entry.card || (entry.destroyedBy && entry.destroyedBy !== "battle")) continue;
    emitSimulatedBattleDestroy(state, { attacker: source, destroyed: entry.card,
      destroyedOwner: entry.owner === "opponent" ? other : owner, destroyedPosition: entry.position || null,
      battleDestroyer: source, recordNegatedBattleActivation: true }, rewardOptions, [source], effects);
  }
  return recipients.some((card, index) => getSporeCount(card) > before[index]!) ? ["Carrioncap battle spore reward"] : [];
}

export function scoreBloomrotBattleAttackCandidate(context: Omit<BattleContext, "game"> = {}) {
  const {
    attacker,
    target,
    lethalNow = false,
    attackerSurvived = false,
    targetSurvived = false,
    summary,
    opponent,
    opponentLpAfter,
  } = context;

  if (!attacker || !isBloomrotMonster(attacker)) return 0;
  if (isBloomrotToken(attacker)) return -100;

  const positiveDamage = Math.max(0, Number(summary?.damage || 0));
  const damageTaken = Math.max(0, -Number(summary?.damage || 0));
  const markedTarget = targetIsMarked(target);
  const predictedAtk = battleAtk(attacker, target, context.state);
  const predictedDestroy = Boolean(target && predictedAtk > battleStat(target));
  const destroyedTarget = Boolean(target && (!targetSurvived || predictedDestroy));
  const predictedSurvival = !target || wouldSurvive(attacker, target);
  const lowOpponentLp =
    Number.isFinite(opponentLpAfter) && Number(opponentLpAfter) <= 2000;
  let delta = 0;

  if (lethalNow) delta += 7;
  if (!target) {
    if (lethalNow) delta += 8;
    else if (positiveDamage >= 2000 || lowOpponentLp) delta += 1.5;
    else if (positiveDamage >= 1000) delta += 0.6;
  }

  if (markedTarget) {
    delta += 0.5 + Math.min(1.5, getSporeCount(target) * 0.25);
    if (destroyedTarget) delta += 1.6 + Math.min(2.2, cardThreat(target) / 1200);
  }

  if (attacker.name === N.ROT_STAG && markedTarget) {
    delta += predictedDestroy ? 2.2 : 0.8;
  }
  if (attacker.name === N.CARRIONCAP && markedTarget && destroyedTarget) {
    delta += 2.4;
  }
  if (attacker.name === N.DEVOURER && markedTarget) {
    delta += destroyedTarget ? 2.8 : 1.1;
  }

  if (attackerSurvived || predictedSurvival || lethalNow) delta += 0.5;
  if (!attackerSurvived && !predictedSurvival && !lethalNow) {
    delta -= KEY_PIECES.has(attacker.name!) ? 3.2 : 1.5;
  }
  if (damageTaken > 0 && !destroyedTarget && !lethalNow) {
    delta -= Math.min(2.5, damageTaken / 600);
  }
  if (
    target &&
    !destroyedTarget &&
    !lethalNow &&
    markedTarget &&
    asArray(opponent?.field).some((card) => card !== target && targetIsMarked(card))
  ) {
    delta -= 0.5;
  }

  return delta;
}
