import type { ChainEffect, ChainStrategyPort, ChainStrategyResponse } from "../../contracts/chainRuntime.js";
import type { AIDecisionPlan } from "../../contracts/ai.js";
import { isFullChainHost } from "../../contracts/chainRuntime.js";
import { walkActionList } from "../../actionHandlers/actionWalker.js";
import { buildTechZeroActivationContext, type TechZeroPolicyContext } from "./priorities.js";
import { TECH_ZERO_IDS as TZ } from "./knowledge.js";
import type { AiCardInput } from "../../contracts/aiState.js";
import { getSimulatedPendingEffectPlans } from "../common/simulation.js";

export type TechZeroChainResponseInput = Parameters<NonNullable<ChainStrategyPort["chooseChainResponse"]>>[0];

/** Resources committed to unresolved effects, including resolution choices. */
export function getTechZeroPendingResources(
  game: unknown, playerId: string | undefined, source?: AiCardInput, effectId?: string,
): { reservedInstanceIds: Array<number | string>; reservedMonsterZones: number } {
  if (!game || typeof game !== "object")
    return { reservedInstanceIds: [], reservedMonsterZones: 0 };
  const chain = "chainSystem" in game && isFullChainHost(game.chainSystem) ? game.chainSystem : null;
  const reserved = new Set<number | string>();
  const slotsByEffect = new Map<string, number>();
  const isCurrent = (card: { instanceId?: number | string | null | undefined }, id: string | undefined) =>
    source?.instanceId != null && source.instanceId === card.instanceId && effectId === id;
  const addPlan = (card: { instanceId?: number | string | null }, effect: ChainEffect | undefined, plan: AIDecisionPlan | undefined) => {
    for (const ids of [...Object.values(plan?.selections || {}), ...Object.values(plan?.specialSummons || {})])
      for (const id of ids) reserved.add(id);
    for (const decision of Object.values(plan?.synchroSummons || {})) {
      reserved.add(decision.synchroInstanceId);
      for (const id of decision.materialInstanceIds) reserved.add(id);
    }
    let slots = Object.values(plan?.specialSummons || {}).reduce((sum, ids) => sum + ids.length, 0);
    for (const { action } of walkActionList([...(effect?.actions || []), ...(effect?.afterResolutionActions || [])]).visits) {
      if (!action || typeof action !== "object" || Reflect.get(action, "type") !== "special_summon_from_zone") continue;
      const ref: unknown = Reflect.get(action, "targetRef");
      if (typeof ref === "string") slots += plan?.selections?.[ref]?.length || 0;
    }
    const key = `${typeof card.instanceId}:${card.instanceId}:${effect?.id}`;
    slotsByEffect.set(key, Math.max(slotsByEffect.get(key) || 0, slots));
  };
  for (const pending of getSimulatedPendingEffectPlans(game)) {
    const card = { instanceId: pending.sourceInstanceId };
    if (pending.ownerId !== playerId || isCurrent(card, pending.effect.id)) continue;
    addPlan(card, pending.effect, pending.decisions);
  }
  if (!chain) return { reservedInstanceIds: [...reserved],
    reservedMonsterZones: [...slotsByEffect.values()].reduce((sum, count) => sum + count, 0) };
  for (const link of chain.chainStack) {
    if (link.controller.id !== playerId || link.activationNegated || link.effectNegated ||
        !["pending", "resolving"].includes(link.resolutionStatus) || isCurrent(link.card, link.effect.id)) continue;
    for (const target of link.declaredTargets) for (const card of target.cards) {
      if (card.instanceId != null) reserved.add(card.instanceId);
    }
    addPlan(link.card, link.effect, link.activationContext?.decisions);
  }
  const occurrences = [...chain.pendingTriggerOccurrences, ...chain.activeTriggerOpportunity?.occurrences || []];
  for (const occurrence of occurrences) for (const entry of occurrence.entries || []) {
    const config = entry.config || entry.pipeline;
    const owner = entry.owner || config?.owner;
    const card = entry.card || config?.card;
    const effect = entry.effect || config?.effect;
    if (owner?.id !== playerId || !card || isCurrent(card, effect?.id)) continue;
    // A collected entry may remain in the opportunity while its published link
    // is negated or resolves. Its completed plan must not become a reservation again.
    if (chain.chainStack.some(link => link.card.instanceId === card.instanceId && link.effect.id === effect?.id)) continue;
    addPlan(card, effect, config?.activationContext?.decisions);
  }
  return { reservedInstanceIds: [...reserved], reservedMonsterZones: [...slotsByEffect.values()].reduce((sum, count) => sum + count, 0) };
}

export function getTechZeroPendingTargetReservations(
  game: unknown, playerId: string | undefined, source?: AiCardInput, effectId?: string,
): Array<number | string> {
  return getTechZeroPendingResources(game, playerId, source, effectId).reservedInstanceIds;
}

function pendingRemovalCanHitNewMonster(input: TechZeroChainResponseInput): boolean {
  const last = input.chainSystem.getLastChainLink();
  const links = isFullChainHost(input.chainSystem) ? input.chainSystem.chainStack : last ? [last] : [];
  return links.some(link => {
    if (link.controller.id === input.player.id || link.activationNegated || link.effectNegated) return false;
    return walkActionList([...(link.effect.actions || []), ...(link.effect.afterResolutionActions || [])]).visits.some(({ action }) => {
      if (typeof action !== "object" || action === null) return false;
      const type: unknown = Reflect.get(action, "type");
      if (typeof type !== "string" || !["destroy", "destroy_targeted_cards", "destroy_cards_by_scope", "banish", "return_to_hand", "move", "mirror_force_destroy_all", "selective_field_destruction"].includes(type)) return false;
      const targetRef: unknown = Reflect.get(action, "targetRef");
      // A declared target cannot change into the future Synchro. Broad or
      // deferred removal remains pending; on-summon negation resolves later.
      return typeof targetRef !== "string" || !link.declaredTargets.some(target =>
        target.targetId === targetRef && target.cards.length > 0);
    });
  });
}

/** The Chain owns legality; this policy ranks only its canonical candidates. */
export function chooseTechZeroChainResponse(
  input: TechZeroChainResponseInput,
  policy: TechZeroPolicyContext,
): ChainStrategyResponse | null {
  const defense = input.activatable.find(candidate => candidate.card.id === TZ.SINGULARITY &&
    candidate.effect.id === "tech_zero_final_singularity_negate_leave_field") ||
    input.activatable.find(candidate => candidate.card.id === TZ.LANCER &&
      candidate.effect.id === "tech_zero_explosive_lancer_negate_destroy");
  if (defense) return { card: defense.card, effect: defense.effect, candidateKey: defense.candidateKey };
  const opposingResponsePending = isFullChainHost(input.chainSystem) && input.chainSystem.chainStack.some(link =>
    link.controller.id !== input.player.id && !link.activationNegated && !link.effectNegated &&
    ["pending", "resolving"].includes(link.resolutionStatus));
  for (const candidate of input.activatable) {
    const isRevival = candidate.card.id === TZ.COURT && candidate.effect.id === "court_of_the_dead_revive";
    if (candidate.card.id !== TZ.SCRAPYARD && !isRevival) continue;
    const source = (policy.player.spellTrap || []).find(card => card.instanceId === candidate.card.instanceId);
    const effect = source?.effects?.find(entry => entry.id === candidate.effect.id);
    if (!source || !effect?.id) continue;
    if (policy.directLethalAvailable && !opposingResponsePending) continue;
    if (pendingRemovalCanHitNewMonster(input)) continue;
    const activation = buildTechZeroActivationContext(source, effect, policy);
    if (isRevival) {
      if (!activation.decisions?.selections?.court_revive_target?.length) continue;
      return { card: candidate.card, effect: candidate.effect, candidateKey: candidate.candidateKey,
        activationContext: { decisions: activation.decisions, autoSelectTargets: true } };
    }
    const plan = activation.decisions?.synchroSummons?.[effect.id];
    if (!plan) continue;
    return { card: candidate.card, effect: candidate.effect, candidateKey: candidate.candidateKey,
      activationContext: { ...(activation.decisions ? { decisions: activation.decisions } : {}), autoSelectTargets: true } };
  }
  const declinedCandidateKeys = input.activatable.filter(candidate => candidate.card.id === TZ.SCRAPYARD ||
    (candidate.card.id === TZ.COURT && candidate.effect.id === "court_of_the_dead_revive"))
    .map(candidate => candidate.candidateKey);
  return declinedCandidateKeys.length ? { declinedCandidateKeys } : null;
}
