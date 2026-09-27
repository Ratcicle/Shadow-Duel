import type { AiCardInput, AiPlayerInput, AiStateInput } from "../../contracts/aiState.js";
import type { AIActivationContext, AIDecisionPlan } from "../../contracts/ai.js";
import type { EffectDefinition, EffectTarget } from "../../contracts/effects.js";
import type { CanonicalZone } from "../../contracts/zones.js";
import { enumerateSynchroMaterialCombos } from "../../game/summon/synchro.js";
import { matchesTargetFilters, normalizeCount } from "../common/targetSelection.js";
import { resolvePerspectivePlayers } from "../common/perspective.js";
import { evaluateTechZeroVisibleBattle } from "./battle.js";
import { TECH_ZERO_IDS as TZ, isTechZero } from "./knowledge.js";

export interface TechZeroPolicyContext {
  player: AiPlayerInput;
  opponent?: AiPlayerInput;
  turnCounter?: number;
  phase?: string;
  reservedInstanceIds?: readonly (number | string)[];
  reservedMonsterZones?: number;
  directLethalAvailable?: boolean;
  threatenedLethal?: boolean;
}

export interface TechZeroLevelAdjustment {
  caseId: string;
  targetInstanceId: number | string;
  targetRef: string;
}

export type TechZeroResourcePurpose = "kaiser" | "ghost" | "assembly" | "lab";

/** Assembly must preserve a proven attack sequence, including clearing blockers. */
export function getTechZeroVisibleBattlePolicy(game: AiStateInput | undefined, player: AiPlayerInput) {
  const { self, opponent } = resolvePerspectivePlayers(game, player);
  if (!self || !opponent) return { directLethalAvailable: false, threatenedLethal: false };
  const directLethalAvailable = game?.phase === "main1" && game.turn === self.id &&
    (game.turnCounter || 0) > 1 && evaluateTechZeroVisibleBattle(self, opponent, game.turnCounter).lethal;
  const threatenedLethal = evaluateTechZeroVisibleBattle(opponent, self, game?.turnCounter || 0).damage >= self.lp;
  return { directLethalAvailable, threatenedLethal };
}

function rank<Card extends AiCardInput>(cards: readonly Card[], score: (card: Card) => number): Card[] {
  return [...cards].sort((a, b) => score(b) - score(a) ||
    `${typeof a.instanceId}:${a.instanceId}`.localeCompare(`${typeof b.instanceId}:${b.instanceId}`));
}

function sameInstance(a: AiCardInput, b: AiCardInput): boolean {
  return a.instanceId != null && a.instanceId === b.instanceId;
}

function summonDestinations(field: readonly AiCardInput[], ctx: TechZeroPolicyContext): AiCardInput[] {
  return (ctx.player.extraDeck || []).filter(extra =>
    enumerateSynchroMaterialCombos(field, extra).length > 0);
}

/** Local preference among legal candidates, never a replacement for summon legality. */
export function scoreTechZeroSynchro(card: AiCardInput, ctx: TechZeroPolicyContext): number {
  const graveyard = ctx.player.graveyard || [];
  switch (card.id) {
    case TZ.MULTIMODAL: return 45 + (graveyard.some(entry => entry.id === TZ.CORE) ? 15 : 0);
    case TZ.PORTAL: return 40 + 18 * Math.min(3, new Set(graveyard.filter(entry =>
      isTechZero(entry) && (entry.level || 0) <= 4).map(entry => entry.name)).size);
    case TZ.SLASHER: return 40;
    case TZ.MAGE: return 42;
    case TZ.GHOST: return 35;
    case TZ.KAISER: return 40;
    case TZ.PHOENIX: return ctx.threatenedLethal ? 85 : 52;
    case TZ.REACTOR: return ctx.threatenedLethal ? 100 : 58;
    case TZ.LANCER: return 70 + 10 * graveyard.filter(entry => entry.isTuner).length;
    case TZ.SINGULARITY: return ctx.threatenedLethal ? 120 : 90;
    default: return (card.atk || 0) / 100;
  }
}

/** Keep distinct exact procedures even when their Extra Deck destination is unchanged. */
export function enumerateTechZeroLevelAdjustments(
  source: AiCardInput,
  candidates: readonly AiCardInput[],
  ctx: TechZeroPolicyContext,
): TechZeroLevelAdjustment[] {
  const field = ctx.player.field || [];
  if (source.effectsNegated || source.isFacedown || !field.some(card => sameInstance(card, source))) return [];
  const isCore = source.id === TZ.CORE;
  if (!isCore && source.id !== TZ.MULTIMODAL) return [];
  const shifts = isCore ? [-1, 1] : [-2, -1, 1, 2];
  const materialKey = (materials: readonly AiCardInput[]) => JSON.stringify(
    materials.map(card => card.instanceId).sort((a, b) =>
      `${typeof a}:${a}`.localeCompare(`${typeof b}:${b}`)));
  const destinations = (ctx.player.extraDeck || []).map(card => ({ card,
    existing: new Set(enumerateSynchroMaterialCombos(field, card).map(materialKey)) }));
  const choices: { adjustment: TechZeroLevelAdjustment; score: number }[] = [];
  for (const candidate of rank(candidates, () => 0)) {
    if (candidate.instanceId == null || candidate.isFacedown ||
        !field.some(card => sameInstance(card, candidate)) || (isCore && !isTechZero(candidate))) continue;
    for (const amount of shifts) {
      const level = (candidate.level || 0) + amount;
      if (level < 1) continue;
      const adjusted = field.map(card => sameInstance(card, candidate) ? { ...card, level } : card);
      const opened = destinations.filter(({ card, existing }) =>
        enumerateSynchroMaterialCombos(adjusted, card).some(materials => !existing.has(materialKey(materials))))
        .map(entry => entry.card);
      let bestScore = -Infinity;
      for (const destination of opened) {
        let score = scoreTechZeroSynchro(destination, ctx);
        // The two stable opening steps preserve Core as level one and M as a live alternate-role material.
        if (isCore && candidate.id === TZ.ELECTROCATAPULT && level === 2 && destination.id === TZ.MULTIMODAL) score += 100;
        if (!isCore && sameInstance(candidate, source) && level === 1 && destination.id === TZ.PORTAL) score += 100;
        if (score <= bestScore) continue;
        bestScore = score;
      }
      if (bestScore > -Infinity) {
        const direction = amount < 0 ? "decrease" : "increase";
        const refDirection = amount < 0 ? "down" : "up";
        choices.push({ score: bestScore, adjustment: {
          caseId: isCore ? direction : `${direction}_${Math.abs(amount)}`,
          targetInstanceId: candidate.instanceId,
          targetRef: isCore ? `tech_zero_energy_core_level_${refDirection}_target` :
            `tech_zero_multimodal_machine_level_${refDirection}_${Math.abs(amount)}_target`,
        } });
      }
    }
  }
  return choices.sort((a, b) => b.score - a.score).map(entry => entry.adjustment);
}

export function chooseTechZeroLevelAdjustment(
  source: AiCardInput, candidates: readonly AiCardInput[], ctx: TechZeroPolicyContext,
): TechZeroLevelAdjustment | null {
  return enumerateTechZeroLevelAdjustments(source, candidates, ctx)[0] || null;
}

function recoveryValue(card: AiCardInput): number {
  switch (card.id) {
    case TZ.MULTIMODAL: return 100;
    case TZ.ELECTROCATAPULT: return 90;
    case TZ.CORE: return 80;
    case TZ.SLASHER: return 65;
    case TZ.PRISM: return 55;
    case TZ.RAPTOR: return 50;
    case TZ.WYVERN: return 45;
    case TZ.PULSE: return 40;
    default: return (card.atk || 0) / 100;
  }
}

export function chooseTechZeroPortalTargets<Card extends AiCardInput>(
  candidates: readonly Card[], ctx: TechZeroPolicyContext, max = 3,
): Card[] {
  const slots = Math.max(0, 5 - (ctx.player.field || []).length - (ctx.reservedMonsterZones || 0));
  const count = Math.max(0, Math.min(max, slots, 3));
  const result: Card[] = [];
  const names = new Set<string>();
  for (const card of rank(candidates, recoveryValue)) {
    if (result.length >= count) break;
    if (card.instanceId == null || !card.name || names.has(card.name)) continue;
    if (ctx.reservedInstanceIds?.includes(card.instanceId)) continue;
    result.push(card);
    names.add(card.name);
  }
  return result;
}

export function chooseTechZeroRevival<Card extends AiCardInput>(
  source: AiCardInput, candidates: readonly Card[], ctx: TechZeroPolicyContext,
): Card | null {
  const field = ctx.player.field || [];
  if (field.length + (ctx.reservedMonsterZones || 0) >= 5) return null;
  return rank(candidates.filter(candidate => candidate.instanceId != null && !ctx.reservedInstanceIds?.includes(candidate.instanceId)), candidate => {
    // Catapult's material effect negates M, which retains its printed Synchro Tuner type.
    const revived = { ...candidate, isFacedown: false, effectsNegated: source.id === TZ.ELECTROCATAPULT };
    const destinations = summonDestinations([...field, revived], ctx);
    const bossValue = destinations.filter(card => card.id === TZ.LANCER || card.id === TZ.SINGULARITY)
      .reduce((value, card) => Math.max(value, scoreTechZeroSynchro(card, ctx)), 0);
    const coreBridge = candidate.id === TZ.CORE && field.some(card =>
      card.id === TZ.MULTIMODAL && !card.effectsNegated) &&
      (ctx.player.extraDeck || []).some(card => card.id === TZ.PORTAL);
    return recoveryValue(candidate) + bossValue * 3 + (coreBridge ? 130 : 0);
  })[0] || null;
}

/** Reserve concrete GY resources for already visible follow-ups and caller plans. */
export function getTechZeroReservedResources(ctx: TechZeroPolicyContext): Set<number | string> {
  const reserved = new Set(ctx.reservedInstanceIds || []);
  const field = ctx.player.field || [];
  const graveyard = ctx.player.graveyard || [];
  const tuners = graveyard.filter(card => card.isTuner && card.instanceId != null);
  const lancerReady = field.some(card => card.id === TZ.LANCER) ||
    summonDestinations(field, ctx).some(card => card.id === TZ.LANCER);
  if (lancerReady) for (const card of tuners) {
    if (card.instanceId != null) reserved.add(card.instanceId);
  }
  const hasScrapyard = [...ctx.player.hand || [], ...ctx.player.spellTrap || []]
    .some(card => card.id === TZ.SCRAPYARD);
  if (hasScrapyard && field.length < 5) {
    const candidates = tuners.filter(card => summonDestinations([
      ...field, { ...card, isFacedown: false, effectsNegated: false },
    ], ctx).length > 0);
    const selected = rank(candidates, recoveryValue)[0];
    if (selected?.instanceId != null) reserved.add(selected.instanceId);
  }
  if (field.some(card => card.id === TZ.ELECTROCATAPULT)) {
    const core = rank(graveyard.filter(card => card.id === TZ.CORE), recoveryValue)[0];
    if (core?.instanceId != null) reserved.add(core.instanceId);
  }
  return reserved;
}

export function chooseTechZeroResourceTargets<Card extends AiCardInput>(
  purpose: TechZeroResourcePurpose,
  candidates: readonly Card[], ctx: TechZeroPolicyContext, max = 3,
): Card[] {
  const reserved = getTechZeroReservedResources(ctx);
  const emergency = purpose === "assembly" && ctx.threatenedLethal === true && !ctx.directLethalAvailable;
  const available = candidates.filter(card => card.instanceId != null &&
    !ctx.reservedInstanceIds?.includes(card.instanceId) && (emergency || !reserved.has(card.instanceId)));
  return rank(available, card => purpose === "ghost" ? recoveryValue(card) :
    -recoveryValue(card) + (purpose === "kaiser" ? (card.level || 0) * 2 : 0))
    .slice(0, Math.max(0, max));
}

export function chooseTechZeroPrismDiscard<Card extends AiCardInput>(
  candidates: readonly Card[], ctx: TechZeroPolicyContext,
): Card | null {
  const reserved = getTechZeroReservedResources(ctx);
  return rank(candidates.filter(card => card.instanceId != null && !reserved.has(card.instanceId)), card => {
    // Core discarded as cost is immediately available to the searched Catapult's Normal trigger.
    if (card.id === TZ.CORE) return 100;
    if (card.id === TZ.PULSE) return 55;
    return 10;
  })[0] || null;
}

export function techZeroConnectorNormalAvailable(card: AiCardInput): boolean {
  return card.id === TZ.CONNECTOR && !card.effectsNegated && !card.isFacedown;
}

export function scoreTechZeroSummon(card: AiCardInput, ctx: TechZeroPolicyContext, method: "normal" | "special" = "normal"): number {
  const hand = ctx.player.hand || [];
  const field = ctx.player.field || [];
  let score = (card.atk || 0) / 100;
  if (method === "normal" && card.id === TZ.ELECTROCATAPULT && !card.effectsNegated &&
      [...hand, ...ctx.player.graveyard || []].some(entry => entry.id === TZ.CORE || entry.id === TZ.PULSE)) score += 75;
  if (card.id === TZ.CORE) score += 25;
  if (card.id === TZ.MULTIMODAL) score += 50;
  if (techZeroConnectorNormalAvailable(card) && field.length <= 3 &&
      !field.some(techZeroConnectorNormalAvailable) && (ctx.player.summonCount || 0) <= 1 &&
      hand.some(entry => !sameInstance(card, entry) && isTechZero(entry) &&
        entry.cardKind === "monster" && (entry.level || 0) <= 4)) score += 65;
  return score;
}

/** Tactical booleans are supplied by the strategy's existing battle assessment. */
export function shouldUseTechZeroAssembly(ctx: TechZeroPolicyContext): { allow: boolean; reason: string } {
  if (ctx.directLethalAvailable) return { allow: false, reason: "Preserve the available direct-attack lethal" };
  const costs = (ctx.player.graveyard || []).filter(card => card.cardKind === "monster" && isTechZero(card));
  if (chooseTechZeroResourceTargets("assembly", costs, ctx, 2).length < 2) {
    return { allow: false, reason: "Preserve resources needed by the visible follow-up" };
  }
  if ((ctx.player.field || []).length >= 5) return { allow: false, reason: "No open Monster Zone" };
  return { allow: true, reason: ctx.threatenedLethal ? "Spend resources to survive the next battle" : "Two expendable resources enable a recruit" };
}

function zoneCards(player: AiPlayerInput | undefined, zone: CanonicalZone): readonly AiCardInput[] {
  if (!player) return [];
  if (zone === "fieldSpell") return player.fieldSpell ? [player.fieldSpell] : [];
  return player[zone] || [];
}

function targetCandidates(target: EffectTarget, source: AiCardInput, ctx: TechZeroPolicyContext,
  selections: Readonly<Record<string, readonly (number | string)[]>>): AiCardInput[] {
  const roles = target.owner === "opponent" ? ["opponent"] as const :
    target.owner === "any" ? ["self", "opponent"] as const : ["self"] as const;
  const zones = target.zones || [target.zone || "field"];
  const excluded = target.excludeTargetRef ? selections[target.excludeTargetRef] || [] : [];
  const result: AiCardInput[] = [];
  for (const role of roles) for (const zone of zones) {
    for (const card of zoneCards(role === "self" ? ctx.player : ctx.opponent, zone)) {
      if (card.instanceId == null || excluded.includes(card.instanceId) || result.some(other => sameInstance(card, other))) continue;
      if (matchesTargetFilters(card, target, source, role)) result.push(card);
    }
  }
  return result;
}

function instanceIds(cards: readonly AiCardInput[]): Array<number | string> {
  return cards.flatMap(card => card.instanceId == null ? [] : [card.instanceId]);
}

function scrapyardChoice(candidates: readonly AiCardInput[], ctx: TechZeroPolicyContext) {
  const choices: Array<{ tuner: AiCardInput; decision: NonNullable<AIDecisionPlan["synchroSummons"]>[string]; score: number }> = [];
  for (const tuner of candidates) {
    const revived = { ...tuner, isFacedown: false, effectsNegated: false };
    for (const destination of ctx.player.extraDeck || []) {
      if (destination.instanceId == null || ctx.reservedInstanceIds?.includes(destination.instanceId)) continue;
      for (const materials of enumerateSynchroMaterialCombos([...(ctx.player.field || []), revived], destination)) {
        if ((ctx.player.field || []).length + 2 - materials.length + (ctx.reservedMonsterZones || 0) > 5) continue;
        if (materials.some(card => card.instanceId != null && ctx.reservedInstanceIds?.includes(card.instanceId))) continue;
        const materialInstanceIds = instanceIds(materials);
        if (materialInstanceIds.length !== materials.length || !materials.some(card => sameInstance(card, revived))) continue;
        choices.push({ tuner, score: scoreTechZeroSynchro(destination, ctx) - materials.length,
          decision: { synchroInstanceId: destination.instanceId, materialInstanceIds, position: "attack" } });
      }
    }
  }
  choices.sort((a, b) => b.score - a.score || recoveryValue(b.tuner) - recoveryValue(a.tuner));
  return choices[0] || null;
}

/** Compile resource policy into the same exact decision plan used by preview and execution. */
export function buildTechZeroActivationContext(
  source: AiCardInput, effect: EffectDefinition, ctx: TechZeroPolicyContext,
  levelAdjustment?: TechZeroLevelAdjustment,
): AIActivationContext {
  const selections: Record<string, readonly (number | string)[]> = {};
  const cases: Record<string, string> = {};
  const specialSummons: Record<string, readonly (number | string)[]> = {};
  const specialSummonRevalidation: Record<string, "remaining"> = {};
  const synchroSummons: Record<string, NonNullable<AIDecisionPlan["synchroSummons"]>[string]> = {};
  const effectId = effect.id || "techzero_effect";
  const choice = effect.actions?.find(action => action.type === "choose_action_case");
  if (choice) {
    const adjustment = levelAdjustment ?? chooseTechZeroLevelAdjustment(source, ctx.player.field || [], ctx);
    if (adjustment) {
      cases.action_case_choice = adjustment.caseId;
      cases[choice.effectChoiceKey || effectId] = adjustment.caseId;
      selections[adjustment.targetRef] = [adjustment.targetInstanceId];
    }
  }
  for (const target of effect.targets || []) {
    const candidates = targetCandidates(target, source, ctx, selections);
    const count = normalizeCount(target.count, 1);
    let selected: readonly AiCardInput[];
    switch (source.id) {
      case TZ.PRISM: {
        const candidate = target.intent === "cost" ? chooseTechZeroPrismDiscard(candidates, ctx) :
          rank(candidates, card => scoreTechZeroSummon({ ...card, effectsNegated: true }, ctx, "special"))[0];
        selected = candidate ? [candidate] : [];
        break;
      }
      case TZ.KAISER:
        selected = target.id === "tech_zero_turbocharge_kaiser_recycle_targets" ?
          chooseTechZeroResourceTargets("kaiser", candidates, ctx, count.max) :
          [chooseTechZeroRevival(source, candidates, ctx)].filter((card): card is AiCardInput => card !== null);
        break;
      case TZ.GHOST:
        selected = target.id === "tech_zero_ghost_samurai_tuner_target" ?
          chooseTechZeroResourceTargets("ghost", candidates, ctx, count.max) : candidates.slice(0, count.max);
        break;
      case TZ.LAB: {
        const safe = chooseTechZeroResourceTargets("lab", candidates, ctx, candidates.length);
        selected = target.id === "tech_zero_development_lab_synchro_target" ?
          rank(safe, recoveryValue).slice(0, count.max) : safe.slice(0, count.max);
        break;
      }
      case TZ.ASSEMBLY:
        selected = shouldUseTechZeroAssembly(ctx).allow ?
          chooseTechZeroResourceTargets("assembly", candidates, ctx, count.max) : [];
        break;
      case TZ.SCRAPYARD: {
        const plan = scrapyardChoice(candidates, ctx);
        selected = plan ? [plan.tuner] : [];
        if (plan) synchroSummons[effectId] = plan.decision;
        break;
      }
      case TZ.ELECTROCATAPULT:
      case TZ.COURT: {
        const candidate = chooseTechZeroRevival(source, candidates, ctx);
        selected = candidate ? [candidate] : [];
        break;
      }
      default:
        selected = rank(candidates, card => target.intent === "cost" ? -recoveryValue(card) : recoveryValue(card)).slice(0, count.max);
    }
    selections[target.id] = instanceIds(selected);
  }
  if (source.id === TZ.PORTAL) {
    const action = effect.actions?.find(entry => entry.type === "special_summon_from_zone");
    if (action) {
      const candidates = (ctx.player.graveyard || []).filter(card => matchesTargetFilters(card, action.filters || {}, source, "self"));
      specialSummons[effectId] = instanceIds(chooseTechZeroPortalTargets(candidates, ctx, normalizeCount(action.count, 1).max));
      specialSummonRevalidation[effectId] = "remaining";
    }
  }
  if (source.id === TZ.ASSEMBLY && shouldUseTechZeroAssembly(ctx).allow) {
    const candidates = (ctx.player.deck || []).filter(card => isTechZero(card) && card.cardKind === "monster");
    specialSummons[effectId] = instanceIds(rank(candidates, card => scoreTechZeroSummon(card, ctx, "special")).slice(0, 1));
  }
  if (source.id === TZ.PRISM && effectId === "tech_zero_prism_activator_monster_search") {
    const candidates = (ctx.player.deck || []).filter(card => isTechZero(card) && card.cardKind === "monster");
    // The discarded tuner is available to E by the time the search resolves.
    const discardIds = selections.tech_zero_prism_activator_discard_target || [];
    const discards = (ctx.player.hand || []).filter(card => card.instanceId != null && discardIds.includes(card.instanceId));
    const afterCost: TechZeroPolicyContext = { ...ctx, player: { ...ctx.player,
      graveyard: [...ctx.player.graveyard || [], ...discards] } };
    selections[`${effectId}_selection`] = instanceIds(rank(candidates, card => scoreTechZeroSummon(card, afterCost)).slice(0, 1));
  }
  return { effect, effectId, autoSelectTargets: true,
    decisions: { selections, cases, specialSummons, specialSummonRevalidation, synchroSummons } };
}
