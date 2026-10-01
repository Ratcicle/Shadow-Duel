import type { EffectNegationContribution } from "../contracts/cards.js";
import type { CardAction } from "../contracts/actions.js";
import type { EffectDefinition } from "../contracts/effects.js";

/** Contributions belong to the affected presence; provenance does not bind their lifetime. */
export interface NegationState {
  effectsNegated?: boolean | undefined;
  effectsNegatedDuration?: string | number | null | undefined;
  effectsNegationContributions?: EffectNegationContribution[] | undefined;
}

export function normalizeNegationDuration(action: {
  readonly negateEffectsDuration?: string;
  readonly duration?: string;
} = {}): EffectNegationContribution["duration"] {
  return action.negateEffectsDuration === "while_faceup" || action.duration === "while_faceup"
    ? "while_faceup" : "until_end_turn";
}

/** Legacy projected states (including fixtures) are adopted without inventing a source. */
export function getNegationContributions(card: NegationState): EffectNegationContribution[] {
  if (card.effectsNegationContributions?.length) return card.effectsNegationContributions;
  return card.effectsNegated === true ? [{
    duration: card.effectsNegatedDuration === "while_faceup" ? "while_faceup" : "until_end_turn",
    sourceDuelCardId: null,
    sourceEffectId: null,
  }] : [];
}

function projectNegation(card: NegationState, entries: EffectNegationContribution[]): void {
  card.effectsNegationContributions = entries;
  card.effectsNegated = entries.length > 0;
  card.effectsNegatedDuration = entries.length === 0 ? null
    : entries.some(entry => entry.duration === "while_faceup") ? "while_faceup" : "until_end_turn";
}

/** Recompute compatibility projections after restoring typed card state. */
export function synchronizeEffectNegation(card: NegationState): void {
  projectNegation(card, getNegationContributions(card));
}

export function addEffectNegation(
  card: NegationState,
  duration: EffectNegationContribution["duration"],
  source: { readonly duelCardId?: number | undefined } | null | undefined = null,
  effect: { readonly id?: string | undefined } | null | undefined = null,
): void {
  projectNegation(card, [...getNegationContributions(card), {
    duration,
    sourceDuelCardId: source?.duelCardId ?? null,
    sourceEffectId: effect?.id ?? null,
  }]);
}

export function clearEffectNegation(card: NegationState): void {
  projectNegation(card, []);
}

export function expireEffectNegation(card: NegationState, duration: EffectNegationContribution["duration"]): void {
  projectNegation(card, getNegationContributions(card).filter(entry => entry.duration !== duration));
}

/**
 * null means another (or unknown) result is possible. The returned refs are
 * negations of inherited targets, not choices introduced during resolution.
 * Conditions are deliberately not evaluated: every possible branch counts.
 */
function negationTargetRefs(actions: readonly CardAction[]): string[] | null {
  const refs: string[] = [];
  for (const action of actions) {
    let nested: string[] | null;
    switch (action.type) {
      case "add_status":
        if (action.status !== "effectsNegated" || action.remove === true ||
            (action.value !== undefined && action.value !== true)) return null;
        // A field scope replaces targetRef in the status handler.
        if (!action.targetScope && action.targetRef) refs.push(action.targetRef);
        break;
      case "set_stats_to_zero_and_negate":
        if (action.negateEffects === false || action.setAtkToZero !== false ||
            action.setDefToZero !== false) return null;
        refs.push(action.targetRef);
        break;
      case "conditional_actions":
        nested = negationTargetRefs(action.actions);
        if (nested === null) return null;
        refs.push(...nested);
        break;
      case "conditional_target_actions":
        nested = negationTargetRefs([
          ...action.cases.flatMap(entry => entry.actions),
          ...(action.defaultActions || []),
        ]);
        if (nested === null) return null;
        // The condition reads action.targetRef but does not itself negate it.
        refs.push(...nested);
        break;
      case "optional_target_actions": {
        nested = negationTargetRefs(action.actions);
        if (nested === null) return null;
        // Optional choices merge over inherited bindings, shadowing local IDs.
        const localRefs = new Set(action.targets.map(target => target.id));
        refs.push(...nested.filter(ref => !localRefs.has(ref)));
        break;
      }
      case "choose_action_case":
        nested = negationTargetRefs(action.cases.flatMap(entry => entry.actions));
        if (nested === null) return null;
        // Each case executes with its own target map, never the outer map.
        break;
      default:
        return null;
    }
  }
  return refs;
}

/** Costs are separate from resolution results. Unknown or mixed actions keep ordinary eligibility. */
export function requiresUnnegatedTarget(
  effect: Pick<EffectDefinition, "actions"> | null | undefined,
  target: { readonly id?: string | undefined; readonly intent?: string | undefined },
): boolean {
  if (!target.id) return false;
  if (target.intent === "cost" || target.intent === "reference") return false;
  const actions = effect?.actions;
  return !!actions?.length && negationTargetRefs(actions)?.includes(target.id) === true;
}
