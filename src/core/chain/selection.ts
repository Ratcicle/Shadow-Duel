import { isAI } from "../Player.js";
import type {
  ChainActionContext,
  ChainCard,
  ChainEffect,
  ChainEffectEnginePort,
  ChainEffectTarget,
  ChainPlayer,
  PreparedActivationContext,
  ChainSelectionHost,
  ChainSelectionKeyMap,
  ChainSelectionMap,
  ChainSelectionRequirement,
  FastEffectContextInput,
  FullChainHost,
} from "../contracts/chainRuntime.js";
import type { CanonicalZone } from "../contracts/zones.js";
import type { SelectionCandidateKey } from "../contracts/primitives.js";
import type { SelectionResult } from "../contracts/selection.js";

function selectionCards(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.filter((entry: unknown) => Boolean(entry));
  }
  return value ? [value] : [];
}

function selectionCount(definition: ChainEffectTarget) {
  const min = Number(definition?.count?.min ?? definition?.min ?? 1);
  const max = Number(definition?.count?.max ?? definition?.max ?? min);
  return {
    min: Number.isFinite(min) ? min : 1,
    max: Number.isFinite(max) ? max : min,
  };
}

/**
 * Resolves target quantities which are declared relative to a previous
 * activation selection. The original card metadata is never mutated.
 *
 * `countFromSelectionRef` is intentionally a selection-level contract: the
 * dependent target is still declared before the Chain Link is created.
 */
export function resolveCountFromSelectionDefinitions(
  definitions: readonly ChainEffectTarget[],
  selections: ChainSelectionMap = {},
): ChainEffectTarget[] {
  return (definitions || []).map((definition) => {
    const sourceRef = definition?.countFromSelectionRef;
    if (typeof sourceRef !== "string" || sourceRef.length === 0) {
      return definition;
    }
    const count = selectionCards(Reflect.get(selections, sourceRef)).length;
    return {
      ...definition,
      count: { min: count, max: count },
      resolvedCountFromSelectionRef: sourceRef,
      resolvedSelectionCount: count,
    };
  });
}

/**
 * Caps an activation-cost selection to the number of currently legal targets
 * which derive their count from that cost. This prevents a player from paying
 * more than can be targeted after the irreversible cost payment.
 */
export function capCostDefinitionsByLinkedTargetCapacity(
  costDefinitions: readonly ChainEffectTarget[],
  targetDefinitions: readonly ChainEffectTarget[],
  effectEngine: ChainEffectEnginePort | null | undefined,
  context: { activationContext?: PreparedActivationContext | null } | null,
): readonly ChainEffectTarget[] {
  if (typeof effectEngine?.resolveTargets !== "function") {
    return costDefinitions || [];
  }

  const previewContext = {
    ...(context || {}),
    activationContext: {
      ...(context?.activationContext || {}),
      preview: true,
      isPreview: true,
      autoSelectTargets: false,
      autoSelectSingleTarget: false,
    },
  };

  const targetCapacity = (targetDefinition: ChainEffectTarget): number => {
    const preview = effectEngine.resolveTargets(
      [targetDefinition],
      previewContext,
      null,
    );
    if (preview?.ok === true) {
      return selectionCards(
        preview.targets
          ? Reflect.get(preview.targets, targetDefinition.id)
          : undefined,
      ).length;
    }
    const requirement = (preview?.selectionContract?.requirements || []).find(
      (entry) => entry?.id === targetDefinition?.id,
    );
    return Array.isArray(requirement?.candidates)
      ? requirement.candidates.length
      : 0;
  };

  return (costDefinitions || []).map((definition) => {
    if (!definition?.id) return definition;
    const linkedTargets = (targetDefinitions || []).filter(
      (target) => target?.countFromSelectionRef === definition.id,
    );
    if (linkedTargets.length === 0) return definition;

    const capacity = Math.min(
      ...linkedTargets.map((target) => targetCapacity(target)),
    );
    const count = selectionCount(definition);
    const max = Math.min(count.max, capacity);
    return {
      ...definition,
      count: { min: count.min, max },
      cappedByTargetRefs: linkedTargets.map((target) => target.id),
    };
  });
}

/**
 * Check if an effect requires target selection
 * @param {Object} effect
 * @returns {boolean}
 */
export function effectRequiresTargets(effect?: ChainEffect | null): boolean {
  return Array.isArray(effect?.targets) && effect.targets.length > 0;
}

export function getActivationCostTargetDefinitions(
  effect?: ChainEffect | null,
): ChainEffectTarget[] {
  return (effect?.targets || []).filter((target) => target?.intent === "cost");
}

export function getDeclaredTargetDefinitions(
  effect?: ChainEffect | null,
): ChainEffectTarget[] {
  return (effect?.targets || []).filter((target) => target?.intent !== "cost" && target?.intent !== "reference");
}

export async function getPlayerSelectionsForDefinitions(
  this: ChainSelectionHost,
  card: ChainCard,
  definitions: readonly ChainEffectTarget[],
  player: ChainPlayer,
  context: FastEffectContextInput | null,
  options: {
    purpose?: "cost" | "target";
    allowCancel?: boolean;
    activationZone?: CanonicalZone | null;
    selections?: ChainSelectionMap;
  } = {},
): Promise<ChainSelectionMap | null> {
  if (!Array.isArray(definitions) || definitions.length === 0) return {};
  const effectEngine = this.game?.effectEngine;
  if (!effectEngine) return null;
  const purpose = options.purpose === "cost" ? "cost" : "target";
  const allowCancel = options.allowCancel !== false;
  const ctx: ChainActionContext = {
    ...context,
    source: card,
    sourceCard: card,
    player,
    opponent: this.getOpponent(player),
    defender: context?.defender || context?.target,
    target: context?.target || context?.defender || null,
    attacker: context?.attacker,
    attackerOwner: context?.attackerOwner,
    defenderOwner: context?.defenderOwner,
    summonedCard: context?.summonedCard || context?.card || null,
    activationZone: options.activationZone || context?.activationZone || null,
    // Dependent targets must retain the selections made before this prompt (e.g. paid costs).
    _actionTargets: context?._actionTargets || {},
    activationContext: {
      ...(context?.activationContext || {}),
      timing: "activation",
      purpose,
      autoSelectSingleTarget: isAI(player),
      autoSelectTargets: false,
    },
  };
  // Discover legal candidates independently of a caller's cached or planned
  // selection. The live resolver applies that choice inside the broker.
  delete ctx.activationContext?.decisions;
  if (ctx.activationContext) Reflect.deleteProperty(ctx.activationContext, "resolvedTargets");
  const targetResult = effectEngine.resolveTargets(definitions, ctx, null);
  const baseTargets: ChainSelectionMap = {};
  definitions.forEach((definition: ChainEffectTarget) => {
    const selected = targetResult?.targets
      ? Reflect.get(targetResult.targets, definition.id)
      : undefined;
    if (selected !== undefined) Reflect.set(baseTargets, definition.id, selected);
  });
  if (targetResult?.ok === false && !targetResult?.needsSelection) return null;
  if (!targetResult?.needsSelection) return baseTargets;
  const contract = targetResult.selectionContract;
  if (!contract) return null;
  contract.kind = purpose;
  contract.timing = "activation";
  contract.purpose = purpose;
  contract.ui = {
    ...(contract.ui || {}),
    allowCancel,
    preventCancel: !allowCancel,
  };

  const requirements = contract.requirements || [];
  const hasCompleteProvidedSelection = requirements.every(requirement =>
    options.selections && Object.prototype.hasOwnProperty.call(options.selections, requirement.id));
  if (this.game && ((isAI(player) && this.game.autoSelector) || hasCompleteProvidedSelection)) {
    const game = this.game;
    const normalizeSelections = (value: unknown): SelectionResult | null => {
      if (!value || typeof value !== "object") return null;
      const result: SelectionResult = {};
      for (const requirement of requirements) {
        const keys: unknown = Reflect.get(value, requirement.id);
        if (!Array.isArray(keys)) return null;
        const candidates = requirement.candidates || [];
        if (new Set(keys).size !== keys.length) return null;
        const selected = keys.flatMap(key => {
          const candidate = candidates.find(candidate => candidate.key === key);
          return candidate ? [candidate] : [];
        });
        const min = requirement.min ?? 1;
        if (selected.length !== keys.length || selected.length < min || selected.length > (requirement.max ?? min)) return null;
        result[requirement.id] = selected.flatMap(candidate => candidate.key ? [candidate.key] : []);
      }
      return result;
    };
    const resolveProvided = (): SelectionResult | null => {
      const providedDefinitions = definitions.filter(definition =>
        options.selections && Object.prototype.hasOwnProperty.call(options.selections, definition.id) &&
        !(isAI(player) && context?.activationContext?.decisions?.selections?.[definition.id] !== undefined));
      const resolved = effectEngine.resolveTargets(providedDefinitions, ctx, options.selections || null);
      if (resolved.ok === false || resolved.needsSelection) return null;
      const selected: SelectionResult = {};
      for (const requirement of requirements) {
        if (!providedDefinitions.some(definition => definition.id === requirement.id)) continue;
        const cards = selectionCards(resolved.targets && Reflect.get(resolved.targets, requirement.id));
        const keys = cards.flatMap(card => {
          const candidate = requirement.candidates?.find(candidate => candidate.cardRef === card);
          return candidate?.key ? [candidate.key] : [];
        });
        if (keys.length !== cards.length) return null;
        selected[requirement.id] = keys;
      }
      return selected;
    };
    const resolveAI = () => {
      const provided = resolveProvided();
      if (!provided) return null;
      const remaining = requirements.filter(requirement => !Object.prototype.hasOwnProperty.call(provided, requirement.id));
      if (remaining.length === 0) return normalizeSelections(provided);
      const remainingContract = { ...contract, requirements: remaining };
      const result = game.autoSelector?.select(remainingContract, {
        owner: player, selectionContract: remainingContract, selectionKind: purpose,
        activationContext: context?.activationContext || {},
      });
      return result?.ok ? normalizeSelections({ ...provided, ...result.selections }) : null;
    };
    const selections = game.requestDecision ? normalizeSelections(await game.requestDecision({
      kind: purpose, actor: player, candidates: [], requireCandidate: false, resolveAI,
      resolveHuman: () => normalizeSelections(resolveProvided()),
      serializeResult: value => ({ selections: Object.fromEntries(requirements.map(requirement => [requirement.id,
        (value?.[requirement.id] || []).map(key => {
          const candidate = requirement.candidates?.find(candidate => candidate.key === key);
          const card = candidate?.cardRef;
          const duelCardId = card ? game.ensureDuelCardId?.(card) ?? card.duelCardId ?? null : null;
          return { duelCardId, cardId: card?.id ?? null, effectId: null, candidateKey: null, key: duelCardId == null ? key : null };
        }),
      ])) }),
      deserializeReplayValue: value => {
        if (!("selections" in value)) return null;
        const result: SelectionResult = {};
        for (const requirement of requirements) {
          result[requirement.id] = (value.selections[requirement.id] || []).flatMap(identity => {
            const candidate = requirement.candidates?.find(candidate => "duelCardId" in identity && identity.duelCardId != null
              ? candidate.cardRef?.duelCardId === identity.duelCardId : candidate.key === identity.key);
            return candidate?.key ? [candidate.key] : [];
          });
        }
        return normalizeSelections(result);
      },
    })) : isAI(player) ? resolveAI() : normalizeSelections(resolveProvided());
    if (!selections) return null;
    return {
      ...baseTargets,
      ...resolveSelectionCards(
        this,
        selections,
        requirements,
        player,
      ),
    };
  }

  const startTargetSelectionSession =
    this.game?.startTargetSelectionSession?.bind(this.game);
  if (!startTargetSelectionSession) return null;
  return new Promise<ChainSelectionMap | null>((resolve) => {
    startTargetSelectionSession({
      owner: player,
      selectionContract: contract,
      message:
        contract.message ||
        (purpose === "cost"
          ? `Select activation cost for ${card.name}`
          : `Select target(s) for ${card.name}`),
      kind: purpose,
      allowCancel,
      preventCancel: !allowCancel,
      execute: (selections) => {
        resolve({
          ...baseTargets,
          ...resolveSelectionCards(
            this,
            selections,
            contract.requirements || [],
            player,
          ),
        });
        return { success: true, needsSelection: false };
      },
      onCancel: allowCancel ? () => resolve(null) : null,
    });
  });
}

/**
 * Get player selections for an effect that requires targets
 * @param {Object} card
 * @param {Object} effect
 * @param {Object} player
 * @param {ChainContext} context
 * @returns {Promise<Object|null>}
 */
export async function getPlayerSelectionsForEffect(
  this: FullChainHost,
  card: ChainCard,
  effect: ChainEffect,
  player: ChainPlayer,
  context: FastEffectContextInput | null,
): Promise<ChainSelectionMap | null> {
  const definitions = this.getDeclaredTargetDefinitions?.(effect) || [];
  if (definitions.length === 0) return {};

  if (typeof this.getPlayerSelectionsForDefinitions === "function") {
    return this.getPlayerSelectionsForDefinitions(
      card,
      definitions,
      player,
      context,
      { purpose: "target", allowCancel: true },
    );
  }

  const effectEngine = this.game?.effectEngine;
  const ui = this.getUI();

  if (!effectEngine || !ui) {
    return null;
  }

  // Build context with attack info if available
  const ctx = {
    source: card,
    player,
    opponent: this.getOpponent(player),
    defender: context?.defender || context?.target,
    attacker: context?.attacker,
    attackerOwner: context?.attackerOwner,
    defenderOwner: context?.defenderOwner,
    activationContext: { autoSelectSingleTarget: isAI(player) },
  };

  // Use resolveTargets to check what selections are needed
  const targetResult = effectEngine.resolveTargets(
    effect.targets || [],
    ctx,
    null,
  );
  const baseTargets = targetResult.targets || {};

  if (targetResult.ok === false) {
    this.log(`Target resolution failed: ${targetResult.reason}`);
    return null;
  }

  // If targets were auto-resolved (e.g., targetFromContext), return them
  if (!targetResult.needsSelection && targetResult.targets) {
    return targetResult.targets;
  }

  // If selection is needed, show selection UI
  if (targetResult.needsSelection && targetResult.selectionContract) {
    const contract = targetResult.selectionContract;

    // Bot must never open the human selection UI — auto-select from candidates
    if (isAI(player) && this.game?.autoSelector) {
      const autoResult = this.game.autoSelector.select(contract, {
        owner: player,
        selectionContract: contract,
        selectionKind: "target",
      });
      const fallbackSelections: ChainSelectionKeyMap = {};
      for (const req of contract.requirements || []) {
        const candidates = Array.isArray(req.candidates) ? req.candidates : [];
        const min = Number(req.min ?? 0);
        const max = Number(req.max ?? min);
        const autoKeys = autoResult?.ok
          ? autoResult.selections?.[req.id]
          : undefined;
        const pickCount = Math.min(
          autoKeys && autoKeys.length >= min ? max : min,
          candidates.length,
        );
        const keys =
          autoResult?.ok && autoResult.selections?.[req.id]
            ? autoResult.selections[req.id]
            : candidates
                .slice(0, pickCount)
                .map((candidate) => candidate.key)
                .filter(
                  (key): key is SelectionCandidateKey =>
                    typeof key === "string",
                );
        Reflect.set(fallbackSelections, req.id, keys);
      }
      const resolvedFallback = resolveSelectionCards(
        this,
        fallbackSelections,
        contract.requirements,
        player,
      );
      return { ...baseTargets, ...resolvedFallback };
    }

    // Use the game's target selection system
    const startTargetSelectionSession =
      this.game?.startTargetSelectionSession?.bind(this.game);
    if (startTargetSelectionSession) {
      return new Promise<ChainSelectionMap | null>((resolve) => {
        startTargetSelectionSession({
          selectionContract: contract,
          message: contract.message || `Select target(s) for ${card.name}`,
          kind: "target",
          allowCancel: true,
          execute: (selections) => {
            // Convert selection keys to actual card references
            const resolvedSelections = resolveSelectionCards(
              this,
              selections,
              contract.requirements,
              player,
            );
            // Merge auto-resolved targets (e.g., targetFromContext) so they
            // are preserved alongside player-chosen selections.
            const mergedSelections = {
              ...baseTargets,
              ...resolvedSelections,
            };
            resolve(mergedSelections);
            return { success: true, needsSelection: false };
          },
          onCancel: () => {
            resolve(null);
          },
        });
      });
    }
  }

  // No selection flow available; return any auto-resolved targets we have.
  return baseTargets;
}

/**
 * Convert selection keys to actual card references
 * @param {Object} selections - Map of requirement id to selected keys
 * @param {Array} requirements - Selection requirements with candidates
 * @param {Object} player
 * @returns {Object} Map of requirement id to card arrays
 */
export function resolveSelectionsToCards(
  selections: ChainSelectionKeyMap,
  requirements: readonly ChainSelectionRequirement[],
  _player: ChainPlayer,
): ChainSelectionMap {
  const resolved: ChainSelectionMap = {};

  for (const req of requirements || []) {
    const selectedValue = Reflect.get(selections, req.id);
    const selectedKeys = Array.isArray(selectedValue) ? selectedValue : [];
    const cards = [];

    for (const key of selectedKeys) {
      // Find the candidate by key
      const candidate = req.candidates?.find((c) => c.key === key);
      if (candidate?.cardRef) {
        cards.push(candidate.cardRef);
      }
    }

    Reflect.set(resolved, req.id, cards);
  }

  return resolved;
}

function resolveSelectionCards(
  host: ChainSelectionHost,
  selections: ChainSelectionKeyMap,
  requirements: readonly ChainSelectionRequirement[],
  player: ChainPlayer,
): ChainSelectionMap {
  return typeof host.resolveSelectionsToCards === "function"
    ? host.resolveSelectionsToCards(selections, requirements, player)
    : resolveSelectionsToCards(selections, requirements, player);
}
