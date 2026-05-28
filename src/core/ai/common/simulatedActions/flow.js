import { getEffectiveAtk } from "../cardStats.js";
import { getCounterValue, setCounterValue } from "../counters.js";
import { estimateMonsterValue, hasArchetype } from "../cardValue.js";
import {
  evaluateSimulatedConditions,
  getStoredBlueprints,
} from "../simulatedConditions.js";
import {
  getCardInstanceId,
  getCostPreference,
  getTargetPreference,
  matchesTargetFilters,
  mergeCostPreference,
  normalizeCount,
  rankCandidates,
  selectSimulatedTargets,
} from "../targetSelection.js";
import {
  attachSimulatedEquip,
  findCardOwner,
  moveCardToZone,
  removeCardFromZones,
} from "../zones.js";
import {
  applySummonState,
  chooseRankedCards,
  getActionCandidates,
  hasOpenMonsterZone,
  hasRequiredSelections,
  markSimulatedPassiveUsed,
  pickCountForAction,
  resolveActionPlayer,
  resolveSimulatedLpCost,
  resolveTargetsForAction,
  STOP_SIMULATION,
} from "./shared.js";

export function applyConditionalTargetActions(ctx) {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const sourceCard = options.sourceCard || null;
  const caseTargets = targets.length > 0 ? targets : [sourceCard].filter(Boolean);
  const matchesCase = (caseEntry) => {
    if (!caseEntry) return false;
    if (
      caseEntry.conditions &&
      !evaluateSimulatedConditions(caseEntry.conditions, {
        state,
        selfId,
        options,
        sourceCard,
      })
    ) {
      return false;
    }
    const filters = caseEntry.filters || caseEntry.filter;
    if (!filters || Object.keys(filters).length === 0) return true;
    const matchMode = action.matchMode === "all" ? "all" : "any";
    if (matchMode === "all") {
      return caseTargets.every((card) =>
        matchesTargetFilters(
          card,
          filters,
          sourceCard,
          findCardOwner(state, card) === self ? "self" : "opponent",
        )
      );
    }
    return caseTargets.some((card) =>
      matchesTargetFilters(
        card,
        filters,
        sourceCard,
        findCardOwner(state, card) === self ? "self" : "opponent",
      )
    );
  };
  const chosenCase = (action.cases || []).find(matchesCase);
  const nestedActions = chosenCase?.actions || action.defaultActions || [];
  if (nestedActions.length === 0) return;
  applySimulatedActions({
    actions: nestedActions,
    selections,
    state,
    selfId,
    options,
  });
  return;
}

export function applyActivateStoredBlueprint(ctx) {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const sourceCard = options.sourceCard;
  const blueprint = getStoredBlueprints(sourceCard)[0];
  const effect = blueprint?.effectSnapshot || blueprint?.effect || null;
  if (!effect) return;
  if (
    effect.conditions &&
    !evaluateSimulatedConditions(effect.conditions, {
      state,
      selfId,
      options,
      sourceCard,
    })
  ) {
    return;
  }
  const blueprintSelections = selectSimulatedTargets({
    targets: effect.targets || [],
    actions: effect.actions || [],
    state,
    sourceCard,
    selfId,
    options,
  });
  if (!hasRequiredSelections(effect.targets || [], blueprintSelections)) {
    return;
  }
  applySimulatedActions({
    actions: effect.actions || [],
    selections: blueprintSelections,
    state,
    selfId,
    options: {
      ...options,
      sourceCard,
      activationContext: {
        ...(options.activationContext || {}),
        blueprintSourceCardId: blueprint.sourceCardId,
        blueprintId: blueprint.blueprintId,
      },
    },
  });
  return;
}

export function applyChooseActionCase(ctx) {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  const validCases = (action.cases || [])
    .map((choiceCase) => {
      if (!choiceCase) return null;
      if (
        choiceCase.conditions &&
        !evaluateSimulatedConditions(choiceCase.conditions, {
          state,
          selfId,
          options,
        })
      ) {
        return null;
      }
      const caseSelections = selectSimulatedTargets({
        targets: choiceCase.targets || [],
        actions: choiceCase.actions || [],
        state,
        sourceCard: options.sourceCard,
        selfId,
        options,
      });
      if (!hasRequiredSelections(choiceCase.targets || [], caseSelections)) {
        return null;
      }
      return { choiceCase, caseSelections };
    })
    .filter(Boolean);
  if (validCases.length === 0) return;

  const chooser =
    options.chooseActionCase ||
    options.strategy?.chooseActionCase?.bind(options.strategy);
  let chosenEntry = null;
  if (typeof chooser === "function") {
    const chosen = chooser(
      validCases.map((entry) => entry.choiceCase),
      {
        state,
        action,
        source: options.sourceCard,
        activationContext: options.activationContext,
      },
    );
    chosenEntry =
      validCases.find((entry) => entry.choiceCase === chosen) ||
      validCases.find((entry) => entry.choiceCase.id === chosen?.id) ||
      validCases.find((entry) => entry.choiceCase.id === chosen);
  }
  if (!chosenEntry) chosenEntry = validCases[0];

  applySimulatedActions({
    actions: chosenEntry.choiceCase.actions || [],
    selections: chosenEntry.caseSelections,
    state,
    selfId,
    options,
  });
  return;
}

export function applyShuffleDeck(ctx) {
  const {
    action,
    targets,
    selections,
    state,
    selfId,
    options,
    self,
    opponent,
    applySimulatedActions,
  } = ctx;
  return;
}
