import { getUI } from "./shared.js";
import { cardDatabase } from "../../data/cards.js";
import type { ActionCase, ActionOf, CardAction } from "../contracts/actions.js";
import type {
  ActionRuntimeCard,
  ActionRuntimeGamePort,
  ActionRuntimePlayer,
  ActionTargetResolution,
  ActionHandlerEnginePort,
  EffectContext,
  NormalizedActionExecutionResult,
  ResolvedTargetMap,
} from "../contracts/actionRuntime.js";
import type { EffectCondition, EffectTarget } from "../contracts/effects.js";
import type {
  RawSelectionCandidate,
  RawSelectionContract,
  RawSelectionRequirement,
  SelectionKind,
  SelectionMetadata,
  SelectionResult,
} from "../contracts/selection.js";
import {
  getCardDisplayName,
  getMonsterTypeLabel,
  getUIText,
  type DisplayCard,
} from "../i18n.js";

const DEFAULT_CHOICE_IMAGE = "assets/card-back.png";

type ChooseActionCaseAction = ActionOf<"choose_action_case">;
type DeclareCardPropertyAction = ActionOf<"declare_card_property"> & {
  readonly requirementId?: string;
  readonly choiceImage?: string;
};
type ChoiceValue = string | number | boolean;

interface ChoiceCardReference {
  id: string;
  name: string;
  label: string;
  description: string;
  cardKind: string;
  image: string;
}

interface ChoiceCandidate extends RawSelectionCandidate {
  key: string;
  name: string;
  owner: string;
  controller: string;
  zone: "choice";
  zoneIndex: number;
  position: string;
  atk: null;
  def: null;
  cardKind: string;
  cardRef: ChoiceCardReference;
}

interface ChoiceSelectionRequirement extends RawSelectionRequirement {
  id: string;
  label: string;
  min: number;
  max: number;
  candidates: ChoiceCandidate[];
}

interface ChoiceSelectionContract extends RawSelectionContract {
  kind: "choice";
  message: string;
  requirements: ChoiceSelectionRequirement[];
  ui: { allowCancel: boolean; useFieldTargeting: boolean };
  metadata: SelectionMetadata;
}

interface SelectionRunOptions {
  kind?: SelectionKind;
  card?: ActionRuntimeCard | null;
  message?: string | null;
  allowCancel?: boolean;
  context?: EffectContext;
  player?: ActionRuntimePlayer | null;
  activationContext?: EffectContext["activationContext"];
}

interface CompletedTargetResolution {
  ok?: boolean;
  needsSelection?: false;
  targets?: ResolvedTargetMap;
  reason?: string;
}

type TargetResolution = ActionTargetResolution | CompletedTargetResolution;

const translate = getUIText as (
  key: string,
  params?: object,
  fallback?: string | null,
) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTargetResolution(value: unknown): value is TargetResolution {
  if (!isRecord(value)) return false;
  if (Reflect.get(value, "needsSelection") !== true) return true;
  return isRecord(Reflect.get(value, "selectionContract"));
}

function getEffectChoiceKey(
  ctx: EffectContext,
  action: ChooseActionCaseAction,
): string | null {
  return (
    action?.effectChoiceKey ||
    action?.choiceTextKey ||
    ctx?.effect?.id ||
    ctx?.effectId ||
    null
  );
}

function getChoiceFallbackLabel(caseEntry: ActionCase, index: number): string {
  return (
    caseEntry.label ||
    caseEntry.name ||
    caseEntry.title ||
    caseEntry.id ||
    `Option ${index + 1}`
  );
}

function getChoiceCaseText(
  effectChoiceKey: string | null,
  caseId: string,
  field: "label" | "description",
  fallback: string,
): string {
  if (!effectChoiceKey || !caseId) return fallback;
  return translate(
    `effectChoices.${effectChoiceKey}.cases.${caseId}.${field}`,
    {},
    fallback,
  );
}

function getChoiceSelectionMessage(
  effectChoiceKey: string | null,
  action: ChooseActionCaseAction,
  ctx: EffectContext,
): string {
  const source = ctx?.source || null;
  const cardName = source
    ? getCardDisplayName(source) || source.name || ""
    : "";
  const fallback =
    action.selectionMessage || translate("ui.selection.chooseEffect");
  if (!effectChoiceKey) return fallback;
  return translate(
    `effectChoices.${effectChoiceKey}.message`,
    { cardName },
    fallback,
  );
}

function getPropertyLabel(property: string): string {
  if (property === "type") {
    return translate("ui.declaration.typeLabel", {}, "monster Type");
  }
  return String(property || "value");
}

function getPropertyValueLabel(property: string, value: ChoiceValue): string {
  if (property === "type") return getMonsterTypeLabel(value);
  return String(value || "");
}

function getMonsterTypesInDatabase(): string[] {
  return Array.from(
    new Set(
      cardDatabase
        .filter((card) => card?.cardKind === "monster")
        .flatMap((card: Pick<DisplayCard, "type" | "types">) => {
          if (Array.isArray(card.types)) return card.types;
          return card.type ? [card.type] : [];
        })
        .filter(Boolean),
    ),
  ).sort((a, b) =>
    getMonsterTypeLabel(a).localeCompare(getMonsterTypeLabel(b)),
  );
}

function resolveDeclareChoices(action: DeclareCardPropertyAction): ChoiceValue[] {
  if (Array.isArray(action?.choices)) return action.choices.filter(Boolean);
  if (action?.choices === "monster_types_in_database") {
    return getMonsterTypesInDatabase();
  }

  const property = action?.property;
  if (!property) return [];
  return Array.from(
    new Set(
      cardDatabase
        .map((card) => Reflect.get(card, property) as unknown)
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .filter(Boolean),
    ),
  ).sort((a, b) => String(a).localeCompare(String(b)));
}

function getDeclarationExpirationTurn(
  game: ActionRuntimeGamePort,
  action: DeclareCardPropertyAction,
): number | null {
  const currentTurn = Number(game?.turnCounter || 0);
  if (typeof action.expiresOnTurn === "number" && Number.isFinite(action.expiresOnTurn)) {
    return action.expiresOnTurn;
  }
  if (
    typeof action.durationTurns === "number" &&
    Number.isFinite(action.durationTurns)
  ) {
    return currentTurn + Math.max(0, action.durationTurns);
  }
  if (action?.duration === "while_faceup" || action?.duration === "permanent") {
    return null;
  }
  if (action?.duration === "end_of_next_turn") return currentTurn + 1;
  if (action?.duration === "end_of_turn" || action?.duration === "this_turn") {
    return currentTurn;
  }
  return currentTurn;
}

function isAIPlayer(
  player: ActionRuntimePlayer | null | undefined,
): player is ActionRuntimePlayer {
  return player?.controllerType === "ai";
}

function resolveAutoSelection(
  game: ActionRuntimeGamePort,
  selectionContract: RawSelectionContract,
  options: SelectionRunOptions = {},
): { attempted: boolean; selections: SelectionResult | null } {
  const player = options.player || options.context?.player || null;
  if (!isAIPlayer(player)) return { attempted: false, selections: null };

  const autoResult = game?.autoSelector?.select?.(selectionContract, {
    owner: player,
    player,
    source: options.card || options.context?.source || null,
    activationContext:
      options.activationContext || options.context?.activationContext || {},
    selectionContract,
    game,
  });

  return {
    attempted: true,
    selections: autoResult?.ok ? autoResult.selections : null,
  };
}

function buildChoiceCandidates(
  cases: readonly ActionCase[],
  ctx: EffectContext,
  action: ChooseActionCaseAction,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  const requirementId = action.requirementId || "action_case_choice";
  const choiceImage = action.choiceImage || DEFAULT_CHOICE_IMAGE;
  const effectChoiceKey = getEffectChoiceKey(ctx, action);
  const candidates: ChoiceCandidate[] = [];
  const caseByKey = new Map<string, ActionCase>();

  cases.forEach((caseEntry, index) => {
    const baseKey = caseEntry.key || caseEntry.id || `case_${index + 1}`;
    const label = getChoiceCaseText(
      effectChoiceKey,
      baseKey,
      "label",
      getChoiceFallbackLabel(caseEntry, index),
    );
    const description = getChoiceCaseText(
      effectChoiceKey,
      baseKey,
      "description",
      caseEntry.description || "",
    );
    const key = `${requirementId}:${baseKey}`;

    const cardRef = {
      id: caseEntry.id || baseKey,
      name: label,
      label,
      description,
      cardKind: caseEntry.cardKind || "spell",
      image: caseEntry.image || choiceImage,
    };

    const candidate: ChoiceCandidate = {
      key,
      name: label,
      owner: "player",
      controller: ctx?.player?.id || "player",
      zone: "choice",
      zoneIndex: index,
      position: "",
      atk: null,
      def: null,
      cardKind: cardRef.cardKind,
      cardRef,
    };

    if (game?.buildSelectionCandidateKey) {
      candidate.key = game.buildSelectionCandidateKey(candidate, index);
    }

    candidates.push(candidate);
    caseByKey.set(candidate.key, caseEntry);
  });

  return { requirementId, candidates, caseByKey };
}

function buildDeclareChoiceCandidates(
  values: readonly ChoiceValue[],
  action: DeclareCardPropertyAction,
  ctx: EffectContext,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  const requirementId =
    action.requirementId ||
    action.selectionId ||
    `${ctx?.effect?.id || action.type || "declare_card_property"}_choice`;
  const candidates: ChoiceCandidate[] = [];
  const valueByKey = new Map<string, ChoiceValue>();
  const property = action.property;

  values.forEach((value, index) => {
    const label = getPropertyValueLabel(property, value);
    const cardRef = {
      id: String(value),
      name: label,
      label,
      description: label,
      cardKind: "spell",
      image: action.choiceImage || DEFAULT_CHOICE_IMAGE,
    };
    const candidate: ChoiceCandidate = {
      key: `${requirementId}:${String(value)}`,
      name: label,
      owner: "player",
      controller: ctx?.player?.id || "player",
      zone: "choice",
      zoneIndex: index,
      position: "",
      atk: null,
      def: null,
      cardKind: cardRef.cardKind,
      cardRef,
    };

    if (game?.buildSelectionCandidateKey) {
      candidate.key = game.buildSelectionCandidateKey(candidate, index);
    }

    candidates.push(candidate);
    valueByKey.set(candidate.key, value);
  });

  return { requirementId, candidates, valueByKey };
}

function shouldAllowCase(
  caseEntry: ActionCase,
  ctx: EffectContext,
  engine: ActionHandlerEnginePort,
): boolean {
  const conditions = Array.isArray(caseEntry?.conditions)
    ? caseEntry.conditions
    : [];
  if (conditions.length > 0) {
    const conditionResult = engine?.evaluateConditions?.(conditions, ctx);
    if (!conditionResult?.ok) return false;
  }

  const targets = Array.isArray(caseEntry?.targets) ? caseEntry.targets : [];
  const previewCtx = {
    ...ctx,
    activationContext: {
      ...(ctx?.activationContext || {}),
      preview: true,
    },
  };

  if (targets.length > 0) {
    const rawTargetResult = engine.resolveTargets?.(targets, previewCtx, null);
    const targetResult = isTargetResolution(rawTargetResult)
      ? rawTargetResult
      : {};
    if (targetResult.ok === false) return false;
  }

  const actions = Array.isArray(caseEntry?.actions) ? caseEntry.actions : [];
  if (actions.length > 0) {
    const actionResult = engine?.checkActionPreviewRequirements?.(
      actions,
      previewCtx,
    );
    if (actionResult?.ok === false) return false;
  }

  return true;
}

function runSelectionContract(
  game: ActionRuntimeGamePort,
  selectionContract: RawSelectionContract,
  options: SelectionRunOptions = {},
): Promise<SelectionResult | null> {
  return new Promise<SelectionResult | null>((resolve) => {
    let resolved = false;
    const finalize = (value: SelectionResult | null) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const autoSelection = resolveAutoSelection(
      game,
      selectionContract,
      options,
    );
    if (autoSelection.attempted) {
      finalize(autoSelection.selections);
      return;
    }

    if (!game.startTargetSelectionSession) {
      throw new TypeError("game.startTargetSelectionSession is not a function");
    }
    game.startTargetSelectionSession({
      kind: options.kind || selectionContract?.kind || "choice",
      selectionContract,
      card: options.card || null,
      message: options.message || null,
      allowCancel: options.allowCancel !== false,
      resolve: (value) => finalize(Array.isArray(value) ? null : value),
      execute: (selections) => {
        finalize(selections);
        return { success: true, needsSelection: false };
      },
      onCancel: () => finalize(null),
    });
  });
}

async function resolveTargetsWithPrompt(
  engine: ActionHandlerEnginePort,
  ctx: EffectContext,
  targetDefs: readonly EffectTarget[],
): Promise<TargetResolution> {
  const firstResult: unknown = engine.resolveTargets?.(targetDefs, ctx, null);
  let targetResult: TargetResolution = isTargetResolution(firstResult)
    ? firstResult
    : {};
  if (targetResult.needsSelection !== true) {
    return targetResult;
  }

  const game = engine?.game;
  if (!game) return { ok: false, reason: "Game not available." };

  const selections = await runSelectionContract(
    game,
    targetResult.selectionContract,
    {
      kind: targetResult.selectionContract?.kind || "target",
      card: ctx?.source || null,
      allowCancel: true,
      context: ctx,
      player: ctx?.player || null,
      activationContext: ctx?.activationContext || {},
    }
  );

  if (!selections || Object.keys(selections).length === 0) {
    return { ok: false, reason: "Selection cancelled." };
  }

  const resumedResult: unknown = engine.resolveTargets?.(
    targetDefs,
    ctx,
    selections,
  );
  targetResult = isTargetResolution(resumedResult) ? resumedResult : {};
  return targetResult;
}

export async function handleChooseActionCase(
  action: ActionOf<"choose_action_case">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  const player = ctx?.player;
  if (!game || !player) return false;

  const allCases = Array.isArray(action?.cases) ? action.cases : [];
  if (allCases.length === 0) return false;

  const availableCases =
    action.filterAvailableCases === false
      ? allCases
      : allCases.filter((caseEntry) => shouldAllowCase(caseEntry, ctx, engine));

  if (availableCases.length === 0) {
    getUI(game)?.log(getUIText("ui.selection.noValidOptions"));
    return false;
  }

  const { requirementId, candidates, caseByKey } = buildChoiceCandidates(
    availableCases,
    ctx,
    action,
    engine
  );
  const selectionLabel =
    action.selectionLabel || getUIText("ui.selection.effectLabel");
  const effectChoiceKey = getEffectChoiceKey(ctx, action);

  const selectionContract = {
    kind: "choice",
    message: getChoiceSelectionMessage(effectChoiceKey, action, ctx),
    requirements: [
      {
        id: requirementId,
        label: selectionLabel,
        min: 1,
        max: 1,
        candidates,
      },
    ],
    ui: {
      allowCancel: action.allowCancel !== false,
      useFieldTargeting: false,
    },
    metadata: {
      intent: "benefit",
    },
  } satisfies ChoiceSelectionContract;

  const selections = await runSelectionContract(game, selectionContract, {
    kind: action.selectionKind || "choice",
    card: ctx?.source || null,
    allowCancel: action.allowCancel !== false,
    context: ctx,
    player,
    activationContext: ctx?.activationContext || {},
  });

  if (!selections || Object.keys(selections).length === 0) {
    return false;
  }

  const chosenKeys = selections[requirementId] || [];
  const chosenKey = Array.isArray(chosenKeys) ? chosenKeys[0] : chosenKeys;
  const chosenCase = caseByKey.get(chosenKey);

  if (!chosenCase) {
    getUI(game)?.log(getUIText("ui.selection.noValidChoice"));
    return false;
  }

  const caseTargets = Array.isArray(chosenCase.targets)
    ? chosenCase.targets
    : [];
  let resolvedTargets = {};

  if (caseTargets.length > 0) {
    const targetResult = await resolveTargetsWithPrompt(
      engine,
      ctx,
      caseTargets
    );
    if (targetResult.needsSelection) {
      return targetResult;
    }
    if (targetResult.ok === false) {
      getUI(game)?.log(
        targetResult.reason || getUIText("ui.selection.noValidTargets"),
      );
      return false;
    }
    resolvedTargets = targetResult.targets || {};
  }

  const actions = Array.isArray(chosenCase.actions) ? chosenCase.actions : [];
  if (actions.length === 0) {
    return false;
  }

  const result = await engine.applyActions(actions, ctx, resolvedTargets);
  if (result && typeof result === "object" && result.needsSelection) {
    return result;
  }

  return result;
}

export async function handleDeclareCardProperty(
  action: DeclareCardPropertyAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  const player = ctx?.player;
  const source = ctx?.source;
  if (!game || !player || !source || !action?.property || !action?.stateKey) {
    return false;
  }

  const choices = resolveDeclareChoices(action);
  if (choices.length === 0) {
    getUI(game)?.log("No values available to declare.");
    return false;
  }

  let declaredValue = action.value || null;

  if (!declaredValue) {
    const { requirementId, candidates, valueByKey } =
      buildDeclareChoiceCandidates(choices, action, ctx, engine);
    const propertyLabel = getPropertyLabel(action.property);
    const selectionContract = {
      kind: "choice",
      message:
        action.selectionMessage ||
        translate(
          "ui.declaration.chooseValue",
          { propertyLabel },
          `Declare 1 ${propertyLabel}.`,
        ),
      requirements: [
        {
          id: requirementId,
          label: action.selectionLabel || propertyLabel,
          min: 1,
          max: 1,
          candidates,
        },
      ],
      ui: {
        allowCancel: action.allowCancel !== false,
        useFieldTargeting: false,
      },
      metadata: {
        intent: "declare",
        sourceCard: source,
        effectId: ctx?.effect?.id || null,
      },
    } satisfies ChoiceSelectionContract;

    const selections = await runSelectionContract(game, selectionContract, {
      kind: "choice",
      card: source,
      allowCancel: action.allowCancel !== false,
      context: ctx,
      player,
      activationContext: ctx?.activationContext || {},
    });

    if (!selections || Object.keys(selections).length === 0) {
      return false;
    }

    const chosenKeys = selections[requirementId] || [];
    const chosenKey = Array.isArray(chosenKeys) ? chosenKeys[0] : chosenKeys;
    declaredValue = valueByKey.get(chosenKey) || null;
  }

  if (!declaredValue) {
    return false;
  }

  if (!source.declaredValues || typeof source.declaredValues !== "object") {
    source.declaredValues = {};
  }

  const valueLabel = getPropertyValueLabel(action.property, declaredValue);
  Reflect.set(source.declaredValues, action.stateKey, {
    property: action.property,
    value: declaredValue,
    valueLabel,
    declaredOnTurn: game.turnCounter || 0,
    expiresOnTurn: getDeclarationExpirationTurn(game, action),
    duration: action.duration || null,
  });

  getUI(game)?.log(
    translate(
      "ui.declaration.declaredValue",
      {
        cardName: getCardDisplayName(source),
        valueLabel,
      },
      `${getCardDisplayName(source)} declared ${valueLabel}.`,
    ),
  );
  game.updateBoard?.();
  return true;
}
