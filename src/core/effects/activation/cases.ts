import type { EffectActivationCase, EffectDefinition } from "../../contracts/effects.js";
import type { ChainActionContext, ChainEffectEnginePort } from "../../contracts/chainRuntime.js";

interface ActivationCasePreviewPort extends Pick<ChainEffectEnginePort, "evaluateConditions" | "checkActionPreviewRequirements"> {
  resolveTargets(definitions: NonNullable<EffectDefinition["targets"]>, context: ChainActionContext, selections: null): {
    ok?: boolean | undefined;
    needsSelection?: boolean | undefined;
    selectionContract?: { requirements?: readonly { min?: number | undefined; candidates?: readonly unknown[] | undefined }[] | undefined } | undefined;
  };
}

/** Pure projection shared by activation, previews and simulation. */
export function projectEffectActivationCase(
  effect: EffectDefinition,
  activationCase: EffectActivationCase,
): EffectDefinition {
  const { activationCases: _cases, ...parent } = effect;
  return {
    ...parent,
    activationCaseId: activationCase.id,
    conditions: [...(effect.conditions || []), ...(activationCase.conditions || [])],
    targets: [...(effect.targets || []), ...(activationCase.targets || [])],
    activationCosts: [...(effect.activationCosts || []), ...(activationCase.activationCosts || [])],
    actions: [...(effect.actions || []), ...activationCase.actions],
  };
}

export function getAvailableActivationCases(
  engine: ActivationCasePreviewPort,
  effect: EffectDefinition,
  context: ChainActionContext,
): EffectActivationCase[] {
  return (effect.activationCases || []).filter(activationCase => {
    const projected = projectEffectActivationCase(effect, activationCase);
    const ctx: ChainActionContext = {
      ...context, effect: projected,
      activationContext: { ...context.activationContext, preview: true, autoSelectTargets: false },
    };
    if (engine.evaluateConditions?.(projected.conditions || [], ctx)?.ok === false) return false;
    const targets = engine.resolveTargets(projected.targets || [], ctx, null);
    if (targets.ok === false && !targets.needsSelection) return false;
    if (targets.selectionContract?.requirements?.some(requirement =>
      (requirement.candidates?.length || 0) < (requirement.min ?? 1))) return false;
    if (engine.checkActionPreviewRequirements?.(projected.activationCosts || [], ctx)?.ok === false) return false;
    return engine.checkActionPreviewRequirements?.(projected.actions || [], ctx)?.ok !== false;
  });
}
