import type { AIAction, AILineMilestoneScore, AIPlanningContext, AIPlanningProfile, AIState } from "../../contracts/ai.js";
import type { AiCardInput, AiStateShape, SimulatedCardState } from "../../contracts/aiState.js";
import { canUseNormalSummonForCard } from "../../Player.js";
import { enumerateSynchroMaterialCombos } from "../../game/summon/synchro.js";
import { getEffectiveAtk, getBattleStatForAttackTarget } from "../common/cardStats.js";
import { canSimulatedSpecialSummon, canSimulatedProcedureEnterField } from "../common/simulation.js";
import { getGenericSynchroActions } from "../common/actionGeneration.js";
import { createPlanningCopy } from "../common/planningCopy.js";
import { moveCardToZone } from "../common/zones.js";
import { hasSimulatedProtection } from "../common/simulatedActions/lifecycle.js";
import { TECH_ZERO_IDS as TZ, TECH_ZERO_MILESTONES as M, isTechZero } from "./knowledge.js";
import { evaluateTechZeroVisibleBattle } from "./battle.js";

const BOSS_IDS: ReadonlySet<number> = new Set([TZ.REACTOR, TZ.LANCER, TZ.SINGULARITY]);
const MILESTONE_VALUES: Readonly<Record<string, number>> = {
  [M.MACHINE_ACCESS]: 9,
  [M.PORTAL_RECOVERY]: 12,
  [M.SYNCHRO_TUNER]: 4,
  [M.PROTECTED_BOSS]: 2,
  [M.FOLLOW_UP]: 2,
};

const known = (card: SimulatedCardState) => !card._simUnknownDraw;
const faceUp = (card: SimulatedCardState) => !card.isFacedown;
const isBoss = (card: AiCardInput) => card.id != null && BOSS_IDS.has(card.id);

/** Spend the first slots on distinct destinations, then compare alternate exact procedures. */
export function selectTechZeroPlanningCandidates(actions: readonly AIAction[], limit: number): AIAction[] {
  const primary: AIAction[] = [], alternatives: AIAction[] = [];
  const destinations = new Set<number | string>();
  for (const action of [...actions].sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
    if (action.type !== "synchro") { primary.push(action); continue; }
    if (destinations.has(action.synchroInstanceId)) alternatives.push(action);
    else { destinations.add(action.synchroInstanceId); primary.push(action); }
  }
  return [...primary, ...alternatives].slice(0, Math.max(0, limit));
}

/** Profiles inspect owned, known resources only; Deck order and opposing secrets are irrelevant. */
export function getTechZeroPlanningProfile(game: AIState, context: AIPlanningContext = {}): AIPlanningProfile {
  const self = game._isPerspectiveState ? game.bot :
    [game.player, game.bot].find(player => player?.id === game.turn);
  const phase = context.phase || game.phase;
  const resources = [...self?.hand || [], ...self?.field || [], ...self?.graveyard || [],
    ...self?.spellTrap || [], ...(self?.fieldSpell ? [self.fieldSpell] : [])];
  const hasEngine = resources.some(card => !("_simUnknownDraw" in card && card._simUnknownDraw) && isTechZero(card));
  const enabled = (phase === "main1" || phase === "main2") && hasEngine &&
    game.turn === self?.id && context.profile?.enabled !== false;
  const limit = (key: keyof AIPlanningProfile, gameKey: string, fallback: number, max: number): number => {
    const value: unknown = context.profile?.[key] ?? Reflect.get(game, gameKey);
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(1, Math.min(max, Math.floor(value))) : fallback;
  };
  return {
    enabled, mode: enabled ? "always" : "off", turnMode: "mainOnly", allowEarlyStop: true,
    beamWidth: limit("beamWidth", "turnLineSearchBeamWidth", 6, 12),
    maxDepth: limit("maxDepth", "turnLineSearchMaxDepth", 8, 12),
    nodeBudget: limit("nodeBudget", "turnLineSearchNodeBudget", 720, 2000),
    candidateLimit: limit("candidateLimit", "turnLineSearchCandidateLimit", 12, 24),
  };
}

function bossAccess(state: AiStateShape, field = state.bot.field): boolean {
  return state.bot.extraDeck.some(destination => isBoss(destination) &&
    canSimulatedSpecialSummon(destination, state.bot, "synchro", "extraDeck") &&
    enumerateSynchroMaterialCombos(field, destination).some(materials =>
      materials.some(card => card.monsterType === "synchro" && card.isTuner) &&
      canSimulatedProcedureEnterField(destination, { field }, state.player, materials)));
}

function hasCoreAccess(state: AiStateShape): boolean {
  const self = state.bot;
  if (self.field.some(card => card.id === TZ.CORE && faceUp(card))) return true;
  if (self.field.length >= 5) return false;
  return self.hand.some(card => known(card) && card.id === TZ.CORE &&
    canUseNormalSummonForCard(self, card)) ||
    (self.graveyard.some(card => card.id === TZ.CORE && canSimulatedSpecialSummon(card, self, "special", "graveyard")) &&
      self.hand.some(card => known(card) && card.id === TZ.ELECTROCATAPULT &&
        canUseNormalSummonForCard(self, card)));
}

/** A resource counts as reconstruction only with its visible counterpart, never merely by card name. */
function hasFollowUp(state: AiStateShape): boolean {
  const self = state.bot;
  const grave = self.graveyard.filter(card => card.cardKind === "monster" && isTechZero(card));
  const support = [...self.hand.filter(known), ...self.spellTrap, ...(self.fieldSpell ? [self.fieldSpell] : [])];
  const revivable = grave.filter(card => canSimulatedSpecialSummon(card, self, "special", "graveyard"));
  // The Normal trigger summons any small Tech-Zero, including non-Tuners.
  // Reserve room for both Catapult and its target, and honor this turn's Normal availability.
  if (self.hand.some(catapult => known(catapult) && catapult.id === TZ.ELECTROCATAPULT &&
    canUseNormalSummonForCard(self, catapult) &&
    canSimulatedProcedureEnterField(catapult, self, state.player, []) &&
    (["hand", "graveyard"] as const).some(zone => self[zone].some(target => known(target) &&
      target.cardKind === "monster" && isTechZero(target) && (target.level || 0) <= 2 &&
      canSimulatedSpecialSummon(target, self, "special", zone) &&
      canSimulatedProcedureEnterField(target, { field: [...self.field, catapult] }, state.player, []))))) return true;
  // The material trigger is reachable only through a legal procedure containing Catapult.
  // Its Tuner can already be in the GY or enter it as part of that exact procedure.
  if (self.field.some(card => card.id === TZ.ELECTROCATAPULT && faceUp(card)) &&
    getGenericSynchroActions({ ...state, _isPerspectiveState: true }).some(action => {
      const materials = self.field.filter(card => card.instanceId != null && action.materialInstanceIds.includes(card.instanceId));
      if (!materials.some(card => card.id === TZ.ELECTROCATAPULT)) return false;
      const destination = self.extraDeck.find(card => card.instanceId === action.synchroInstanceId);
      if (!destination) return false;
      // Reuse movement cleanup: a material can be banished instead, and temporary
      // statuses must expire before checking which Tuners can actually be revived.
      const copy = createPlanningCopy();
      const projected = { bot: { ...self }, player: { ...state.player } };
      copy.copyFields(self, projected.bot, Object.keys(self));
      copy.copyFields(state.player, projected.player, Object.keys(state.player));
      for (const id of action.materialInstanceIds) {
        const material = projected.bot.field.find(card => card.instanceId === id);
        if (!material || !moveCardToZone(projected.bot, material, "graveyard", projected.bot, { state: projected })) return false;
      }
      if (!projected.bot.graveyard.some(card => card.id === TZ.ELECTROCATAPULT &&
        card.instanceId != null && action.materialInstanceIds.includes(card.instanceId))) return false;
      const field = [...projected.bot.field, destination];
      return projected.bot.graveyard.some(tuner => tuner.cardKind === "monster" && tuner.isTuner &&
        canSimulatedSpecialSummon(tuner, projected.bot, "special", "graveyard") &&
        canSimulatedProcedureEnterField({ ...tuner, isFacedown: false }, { field }, projected.player, []));
    })) return true;
  if (support.some(card => card.id === TZ.COURT) && revivable.some(card => (card.level || 0) <= 4)) return true;
  if (support.some(card => card.id === TZ.LAB && !card.effectsNegated) &&
    grave.some(card => card.monsterType === "synchro") && grave.length >= 2) return true;
  if (support.some(card => card.id === TZ.SCRAPYARD) && self.field.length < 5 &&
    revivable.some(tuner => tuner.isTuner && bossAccess(state, [...self.field,
      { ...tuner, isFacedown: false, effectsNegated: false }]))) return true;
  return false;
}

function protectedBosses(state: AiStateShape): SimulatedCardState[] {
  return state.bot.field.filter(card => faceUp(card) && isBoss(card) &&
    hasSimulatedProtection(card, "battle_destruction", state.turnCounter) &&
    hasSimulatedProtection(card, "effect_destruction", state.turnCounter,
      { ownerId: state.bot.id, sourceOwnerId: state.player.id }) &&
    card.protectionEffects?.some(entry => entry.source === "Tech-Zero Atomic Slasher"));
}

function milestonesAt(state: AiStateShape | null | undefined): Set<string> {
  const result = new Set<string>();
  if (!state) return result;
  const field = state.bot.field.filter(faceUp);
  if (field.some(card => card.id === TZ.MULTIMODAL && !card.effectsNegated) && hasCoreAccess(state)) result.add(M.MACHINE_ACCESS);
  if (field.some(card => card.id === TZ.PORTAL) && new Set(field.filter(card =>
    card.id !== TZ.PORTAL && isTechZero(card) && (card.level || 0) <= 4).map(card => card.name)).size >= 3) result.add(M.PORTAL_RECOVERY);
  if (bossAccess(state)) result.add(M.SYNCHRO_TUNER);
  if (protectedBosses(state).length > 0) result.add(M.PROTECTED_BOSS);
  if (hasFollowUp(state)) result.add(M.FOLLOW_UP);
  return result;
}

/** Compare the resulting position to the root, rather than adding rewards per visit. */
export function scoreTechZeroLineMilestones(context: AIPlanningContext = {}): AILineMilestoneScore {
  if (context.finalState?._simUnsupportedActions?.length) return { scoreDelta: 0, milestones: [] };
  const initial = milestonesAt(context.initialState);
  const milestones = [...milestonesAt(context.finalState)].filter(milestone => !initial.has(milestone));
  return { scoreDelta: milestones.reduce((score, milestone) => score + (MILESTONE_VALUES[milestone] || 0), 0), milestones };
}

function visibleThreatPenalty(state: AiStateShape): number {
  const threats = state.player.field.filter(card => !card.isFacedown && card.position === "attack");
  const strongest = threats.reduce((max, card) => Math.max(max, getEffectiveAtk(card)), 0);
  const self = state.bot;
  if (self.field.length === 0) return Math.min(12, threats.reduce((sum, card) => sum + getEffectiveAtk(card), 0) / 550);
  const exposures: number[] = [];
  for (const card of self.field) {
    if (hasSimulatedProtection(card, "battle_destruction", state.turnCounter) || card.battleIndestructible) continue;
    // Opposing facedown identities and stats are never inspected. Our own cards are known.
    const defense = card.isFacedown ? Number(card.def || 0) : getBattleStatForAttackTarget(card);
    exposures.push(Math.max(0, strongest - defense) / 700);
  }
  const attacks = threats.reduce((sum, card) => sum + Math.max(0,
    card.attackLimitThisTurn ?? (card.canAttackAllOpponentMonstersThisTurn ? self.field.length : 1 + (card.extraAttacks || 0))), 0);
  return Math.min(15, exposures.sort((a, b) => b - a).slice(0, attacks).reduce((sum, value) => sum + value, 0));
}

function resourceValue(state: AiStateShape): number {
  const self = state.bot;
  const graveNames = new Set(self.graveyard.filter(card => isTechZero(card) &&
    canSimulatedSpecialSummon(card, self, "special", "graveyard")).map(card => card.name));
  // Empty Deck draws are nonfatal in the current rules. Only future supply is discounted.
  const supply = Math.min(3, self.deck.length) * 0.5;
  const backrow = [...self.spellTrap, ...(self.fieldSpell ? [self.fieldSpell] : [])];
  // Moving a card out of hand does not consume it. Preparing a Trap also makes
  // it available on a later turn, even when its targets are not present yet.
  const prepared = backrow.filter(card => card.cardKind === "trap" && !card.effectsNegated).length * 0.25;
  return (self.hand.length + backrow.length) * 0.75 + prepared + graveNames.size * 0.2 +
    supply + (hasFollowUp(state) ? 3 : 0);
}

function boardQuality(state: AiStateShape): number {
  let score = protectedBosses(state).length * 2.5;
  for (const card of state.bot.field) {
    score += 0.3;
    if (card.isFacedown) { score += Math.max(0, card.def || 0) / 2200; continue; }
    score += Math.max(getEffectiveAtk(card), card.def || 0) / 1700;
    if (isBoss(card) && !card.effectsNegated) score += 1.25;
  }
  return score - visibleThreatPenalty(state);
}

function visiblePressure(state: AiStateShape): number {
  if (state.phase !== "main1" || state.turn !== state.bot.id || (state.turnCounter || 0) <= 1) return 0;
  const battle = evaluateTechZeroVisibleBattle(state.bot, state.player, state.turnCounter);
  return (battle.lethal ? 1000 : 0) + battle.damage / 800 + battle.destroyed * 3 -
    battle.damageTaken / 1000 - battle.lost * 4;
}

export function scoreTechZeroLineTerminal(context: AIPlanningContext = {}): number {
  const final = context.finalState;
  if (!final) return Number(context.baseScore ?? context.finalScore ?? 0);
  if (final._simUnsupportedActions?.length || final.bot.lp <= 0) return -10000;
  if (final.player.lp <= 0) return 10000;
  const initial = context.initialState;
  const milestone = scoreTechZeroLineMilestones(context).scoreDelta;
  const dealt = Math.max(0, (initial?.player.lp ?? final.player.lp) - final.player.lp);
  const lost = Math.max(0, (initial?.bot.lp ?? final.bot.lp) - final.bot.lp);
  const actions = context.sequence?.filter(action => action.type !== "simulatedBattle").length || 0;
  const improvedResources = initial ? resourceValue(final) > resourceValue(initial) : false;
  const improvedBoard = initial ? boardQuality(final) > boardQuality(initial) : false;
  const idleCycle = actions >= 3 && milestone === 0 && dealt === 0 && !improvedResources && !improvedBoard;
  // Generic evaluators may inspect facedown identities; this terminal uses public reads only.
  return milestone + resourceValue(final) + boardQuality(final) + visiblePressure(final) + dealt / 800 - lost / 1000 -
    actions * 0.05 - (idleCycle ? Math.min(4, actions * 0.4) : 0);
}

export function describeTechZeroPlannedLine(context: AIPlanningContext = {}): string {
  const sequence = context.sequence || [];
  const steps = sequence.map((action, index) => `${index + 1}. ${action.type}: ${action.type === "simulatedBattle"
    ? action.attackerName || "battle" : action.cardName || action.card?.name || action.name || "visible action"}`);
  const milestones = (context.milestones || scoreTechZeroLineMilestones(context).milestones)
    .map(value => typeof value === "string" ? value : value.label || value.reason || value.id || "");
  const boundary = context.finalState?._simRequiresReplan
    ? "Replan after revealing the drawn card." : "Revalidate and replan after the first action resolves.";
  return `Tech-Zero planner:\n${steps.join("\n") || "Keep the current position."}\n${milestones.join("; ")}\n${boundary}`;
}
