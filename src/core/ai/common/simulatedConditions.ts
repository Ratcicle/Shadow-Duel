import { getCounterValue } from "./counters.js";
import { getPerspectivePlayers } from "./perspective.js";
import { getZoneCards } from "./zones.js";
import {
  asArray,
  getCardInstanceId,
  matchesTargetFilters,
} from "./targetSelection.js";
import { mergeCanonicalSelections } from "../../game/selection/contract.js";
import { walkActionList } from "../../actionHandlers/actionWalker.js";
import type {
  AiStateShape,
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../contracts/aiState.js";
import type { EffectDefinition } from "../../contracts/effects.js";

interface StoredBlueprint {
  effectSnapshot?: EffectDefinition | null;
  effect?: EffectDefinition | null;
}

interface BlueprintStorageView {
  storedBlueprints?: StoredBlueprint[] | null;
}

interface BlueprintCardView {
  state?: { blueprintStorage?: BlueprintStorageView | null } | null;
  blueprintStorage?: BlueprintStorageView | null;
  blueprintStorageState?: BlueprintStorageView | null;
  storedBlueprints?: StoredBlueprint[] | null;
  storedEffects?: StoredBlueprint[] | null;
}

interface SimConditionContext {
  state?: object | null;
  game?: object | null;
  selfId?: string;
  source?: SimulatedCardState | null;
  sourceCard?: SimulatedCardState | null;
  attacker?: SimulatedCardState | null;
  defender?: SimulatedCardState | null;
  target?: SimulatedCardState | null;
  destroyed?: SimulatedCardState | readonly SimulatedCardState[] | null;
  eventCard?: SimulatedCardState | readonly SimulatedCardState[] | null;
  movedCard?: SimulatedCardState | readonly SimulatedCardState[] | null;
  card?: SimulatedCardState | readonly SimulatedCardState[] | null;
  summonedCard?: SimulatedCardState | null;
  battleDestroyer?: SimulatedCardState | null;
  battleDestroyers?: readonly SimulatedCardState[] | null;
  destroyedOwner?: SimulatedPlayerState | string | null;
}

interface SimConditionOptions extends SimConditionContext {
  actionContext?: SimConditionContext | null;
  activationContext?: SimConditionContext | null;
  options?: SimConditionOptions | null;
  strategy?: SimConditionStrategy | null;
  evaluateSimulatedConditions?: SimConditionEvaluator;
}

type SimConditionEvaluator = (
  conditions: unknown,
  context: SimConditionEvaluationContext,
) => unknown;

interface SimConditionStrategy {
  evaluateSimulatedConditions?: SimConditionEvaluator;
}

interface SimConditionEvaluationContext extends SimActivationEvaluationContext {
  options?: SimConditionEvaluationOptions | null;
}

interface PlayerMatchingCondition {
  type?: string;
  owner?: string;
  zone?: string;
  zones?: readonly string[];
  min?: number;
  reason?: string;
  filters?: object;
}

interface EventCardCondition {
  cardRef?: string;
  eventCardRef?: string;
}

interface SimEffectMarker {
  sourceInstanceId?: string | number | null;
  sourceCardId?: string | number | null;
}

interface SimDeclaration {
  expiresOnTurn?: number | null;
  property?: string | null;
  value?: unknown;
}

interface SimTemporarySourceEntry {
  sourceArchetypes?: readonly string[] | null;
  sourceArchetype?: string | null;
  sourceCardId?: string | number | null;
  sourceName?: string | null;
  sourceCardKind?: string | null;
  sourceCardSubtype?: string | null;
}

interface SimTemporaryEventEffectView extends SimTemporarySourceEntry {
  ownerId?: string | null;
  expiresOnTurn?: number | null;
  declaredValues?: object | null;
}

interface SimConditionStateView extends Pick<AiStateShape, "player" | "bot"> {
  turnCounter?: number;
  temporaryEventEffects?: readonly SimTemporaryEventEffectView[] | null;
}

type SimNumericOperator =
  | "eq"
  | "==="
  | "neq"
  | "!="
  | "!=="
  | "lt"
  | "<"
  | "lte"
  | "<="
  | "gte"
  | ">="
  | "gt"
  | ">";

function isObjectValue(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function readProperty(value: object | null | undefined, key: PropertyKey): unknown {
  return value ? Reflect.get(value, key) : undefined;
}

function firstSimulatedCard(value: unknown): SimulatedCardState | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isObjectValue(candidate) ? candidate as SimulatedCardState : null;
}

function storedBlueprintArray(value: unknown): StoredBlueprint[] | null {
  return Array.isArray(value) ? value as StoredBlueprint[] : null;
}

export function getStoredBlueprints(
  card: BlueprintCardView | SimulatedCardState | null | undefined,
): StoredBlueprint[] {
  const cardView = card as BlueprintCardView | null | undefined;
  const storage = cardView?.state?.blueprintStorage || cardView?.blueprintStorage;
  return (
    storedBlueprintArray(cardView?.storedBlueprints) ||
    storedBlueprintArray(cardView?.blueprintStorageState?.storedBlueprints) ||
    storedBlueprintArray(storage?.storedBlueprints) ||
    storedBlueprintArray(cardView?.storedEffects) ||
    []
  );
}

function conditionsArray<Condition>(
  conditions: Condition | readonly Condition[] | null | undefined,
): readonly Condition[] {
  if (!conditions) return [];
  return Array.isArray(conditions)
    ? conditions as readonly Condition[]
    : [conditions as Condition];
}

function playerControlsMatching(
  player: SimulatedPlayerState | null | undefined,
  condition: PlayerMatchingCondition = {},
): boolean {
  const zones = asArray(condition.zones || condition.zone || "field");
  const {
    type: _conditionType,
    owner: _owner,
    zone: _zone,
    zones: _zones,
    min: _min,
    reason: _reason,
    ...directFilters
  } = condition;
  const filters = condition.filters || directFilters;
  return zones.some((zone) =>
    getZoneCards(player, zone).some((card) =>
      matchesTargetFilters(card, filters, null)
    )
  );
}

function resolveConditionSource(
  ctx: SimConditionContext,
  options: SimConditionOptions,
  sourceRef: string | null | undefined,
): SimulatedCardState | null {
  if (!sourceRef || sourceRef === "self" || sourceRef === "source") {
    return ctx.sourceCard || options.sourceCard || null;
  }
  return firstSimulatedCard(
    readProperty(ctx, sourceRef) || readProperty(options, sourceRef) || null,
  );
}

function markerMatchesSource(
  marker: SimEffectMarker | null | undefined,
  sourceCard: SimulatedCardState | null | undefined,
): boolean {
  if (!sourceCard) return false;
  const sourceInstanceId = getCardInstanceId(sourceCard);
  if (marker?.sourceInstanceId || sourceInstanceId) {
    return marker?.sourceInstanceId === sourceInstanceId;
  }
  return (
    marker?.sourceCardId !== undefined && marker.sourceCardId === sourceCard.id
  );
}

function battleParticipantForOwner(
  ctx: SimConditionContext,
  options: SimConditionOptions,
  ownerId: string,
): SimulatedCardState | null {
  const state = (ctx.state || ctx.game || {}) as Pick<
    AiStateShape,
    "player" | "bot"
  >;
  const player =
    ownerId === ctx.selfId || ownerId === "bot"
      ? getPerspectivePlayers(state, ctx.selfId || "bot").self
      : getPerspectivePlayers(state, ctx.selfId || "bot").opponent;
  const attacker =
    ctx.attacker || options.attacker || options.actionContext?.attacker || null;
  const defender =
    ctx.defender ||
    ctx.target ||
    options.defender ||
    options.target ||
    options.actionContext?.defender ||
    options.actionContext?.target ||
    null;
  const matchesOwner = (card: SimulatedCardState | null | undefined) =>
    !!card &&
    ((Array.isArray(player?.field) && player.field.includes(card)) ||
      card.controller === ownerId ||
      card.owner === ownerId);
  if (matchesOwner(attacker)) return attacker;
  if (matchesOwner(defender)) return defender;
  return null;
}

function resolveEventCardByRef(
  condition: EventCardCondition,
  ctx: SimConditionContext,
  options: SimConditionOptions,
): SimulatedCardState | null {
  const ref = condition.cardRef || condition.eventCardRef || null;
  const eventCard =
    (ref &&
      (readProperty(ctx, ref) ||
        readProperty(options, ref) ||
        readProperty(options.actionContext, ref))) ||
    ctx.destroyed ||
    options.destroyed ||
    options.actionContext?.destroyed ||
    ctx.eventCard ||
    options.eventCard ||
    options.actionContext?.eventCard ||
    ctx.movedCard ||
    options.movedCard ||
    options.actionContext?.movedCard ||
    ctx.card ||
    options.card ||
    options.actionContext?.card ||
    ctx.target ||
    options.target ||
    options.actionContext?.target ||
    null;
  return firstSimulatedCard(eventCard);
}

function readSimContextPath(
  ctx: SimConditionContext,
  options: SimConditionOptions,
  key: string | null | undefined,
): unknown {
  if (!key) return undefined;
  const state = ctx.state || ctx.game || {};
  const source = ctx.source || ctx.sourceCard || options.sourceCard || null;
  const roots = [
    { ...ctx, source, sourceCard: source, game: state, state, options },
    ctx,
    options,
    options.actionContext,
    options.activationContext,
  ].filter(Boolean);
  const parts = String(key).split(".").filter(Boolean);
  for (const root of roots) {
    let value: unknown = root;
    for (const part of parts) {
      if (value == null || typeof value !== "object") {
        value = undefined;
        break;
      }
      value = Reflect.get(value, part);
    }
    if (value !== undefined) return value;
  }
  return undefined;
}

function compareSimContextNumbers(
  current: number,
  op: SimNumericOperator,
  expected: number,
): boolean {
  if (op === "eq" || op === "===") return current === expected;
  if (op === "neq" || op === "!=" || op === "!==") return current !== expected;
  if (op === "lt" || op === "<") return current < expected;
  if (op === "lte" || op === "<=") return current <= expected;
  if (op === "gte" || op === ">=") return current >= expected;
  return current > expected;
}

function cardPropertyValues(
  card: SimulatedCardState | null | undefined,
  property: string,
): readonly unknown[] {
  const value = readProperty(card, property);
  if (Array.isArray(value)) return value.filter(Boolean);
  return value !== undefined && value !== null ? [value] : [];
}

function readSimDeclaration(
  card: SimulatedCardState | null | undefined,
  key: string | null | undefined,
): SimDeclaration | null {
  const declarations = card?.declaredValues;
  if (!isObjectValue(declarations)) return null;
  const value = readProperty(declarations, String(key));
  if (isObjectValue(value)) return value as SimDeclaration;
  return value ? {} : null;
}

function readPlayerId(value: unknown): unknown {
  return isObjectValue(value) ? readProperty(value, "id") : value;
}

function declarationIsActive(
  state: { turnCounter?: number } | null | undefined,
  declaration: SimDeclaration | null | undefined,
): boolean {
  if (!declaration || typeof declaration !== "object") return false;
  const expiresOnTurn = declaration.expiresOnTurn;
  return (
    typeof expiresOnTurn !== "number" ||
    !Number.isFinite(expiresOnTurn) ||
    Number(state?.turnCounter || 0) <= expiresOnTurn
  );
}

function declarationMatchesCard(
  state: { turnCounter?: number } | null | undefined,
  declaration: SimDeclaration | null | undefined,
  card: SimulatedCardState,
  property: string,
): boolean {
  if (!declaration || !declarationIsActive(state, declaration)) return false;
  const declaredProperty = declaration.property || property;
  if (declaredProperty !== property) return false;
  return cardPropertyValues(card, property).includes(declaration.value);
}

function declaredValuesMatchCard(
  state: { turnCounter?: number } | null | undefined,
  declaredValues: object | null | undefined,
  card: SimulatedCardState,
  property: string,
  stateKey: string | null | undefined,
): boolean {
  if (!declaredValues || typeof declaredValues !== "object") return false;
  const entries = stateKey
    ? [[stateKey, Reflect.get(declaredValues, stateKey)]]
    : Object.entries(declaredValues);
  return entries.some(([, declaration]) =>
    declarationMatchesCard(
      state,
      isObjectValue(declaration) ? declaration as SimDeclaration : undefined,
      card,
      property,
    ),
  );
}

function activeDeclarationSources(
  player: SimulatedPlayerState | null | undefined,
): SimulatedCardState[] {
  if (!player) return [];
  const sources: SimulatedCardState[] = [];
  for (const zone of ["field", "spellTrap"]) {
    for (const card of getZoneCards(player, zone)) {
      if (!card || card.isFacedown) continue;
      if (!card.declaredValues || typeof card.declaredValues !== "object") {
        continue;
      }
      sources.push(card);
    }
  }
  const fieldSpell = player.fieldSpell || null;
  if (
    fieldSpell &&
    !fieldSpell.isFacedown &&
    fieldSpell.declaredValues &&
    typeof fieldSpell.declaredValues === "object"
  ) {
    sources.push(fieldSpell);
  }
  return sources;
}

function buildSimTemporarySource(entry: SimTemporarySourceEntry | null | undefined) {
  const archetypes = Array.isArray(entry?.sourceArchetypes)
    ? entry.sourceArchetypes
    : entry?.sourceArchetype
      ? [entry.sourceArchetype]
      : [];
  return {
    id: entry?.sourceCardId ?? null,
    name: entry?.sourceName || null,
    cardKind: entry?.sourceCardKind || null,
    subtype: entry?.sourceCardSubtype || null,
    archetype: entry?.sourceArchetype || archetypes[0] || null,
    archetypes,
  };
}

function simActionFilterFromConfig(config: object = {}): object {
  const configuredFilters = readProperty(config, "filters");
  const filters = {
    ...(isObjectValue(configuredFilters) ? configuredFilters : {}),
  };
  for (const key of [
    "cardKind",
    "cardName",
    "name",
    "cardId",
    "cardIds",
    "subtype",
    "monsterType",
    "type",
    "archetype",
    "level",
    "levelOp",
    "minAtk",
    "maxAtk",
    "minDef",
    "maxDef",
    "position",
    "requireFaceup",
    "isToken",
    "isTuner",
    "textIncludes",
    "nameOrDescriptionIncludes",
    "textIncludesAny",
    "sentToGraveAsMaterial",
    "sentAsMaterial",
    "lastSentToGraveAsMaterial",
    "sentToGraveAsMaterialThisTurn",
    "sentAsMaterialThisTurn",
    "sentToGraveAsMaterialTurn",
    "sentAsMaterialTurn",
  ]) {
    const configuredValue = readProperty(config, key);
    if (
      configuredValue !== undefined &&
      readProperty(filters, key) === undefined
    ) {
      Reflect.set(filters, key, configuredValue);
    }
  }
  return filters;
}

function simOwnersFromRule(
  rule: unknown,
  self: SimulatedPlayerState | null | undefined,
  opponent: SimulatedPlayerState | null | undefined,
): SimulatedPlayerState[] {
  const presentPlayers = (
    players: readonly (SimulatedPlayerState | null | undefined)[],
  ): SimulatedPlayerState[] =>
    players.filter(
      (player): player is SimulatedPlayerState => player !== null && player !== undefined,
    );
  if (rule === "opponent") return presentPlayers([opponent]);
  if (rule === "any" || rule === "both" || rule === "either") {
    return presentPlayers([self, opponent]);
  }
  return presentPlayers([self]);
}

function simCardInAllowedZones(
  card: SimulatedCardState,
  zones: unknown,
  owners: readonly (SimulatedPlayerState | null | undefined)[],
): boolean {
  const allowedZones = asArray(zones).filter(
    (zone): zone is string => typeof zone === "string" && zone.length > 0,
  );
  if (allowedZones.length === 0) return true;
  for (const owner of owners.filter(
    (entry): entry is SimulatedPlayerState => entry !== null && entry !== undefined,
  )) {
    for (const zone of allowedZones) {
      if (getZoneCards(owner, zone).includes(card)) return true;
    }
  }
  return false;
}

function simSameCard(left: unknown, right: unknown): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftId = getCardInstanceId(left as SimulatedCardState);
  const rightId = getCardInstanceId(right as SimulatedCardState);
  return leftId !== null && rightId !== null && leftId === rightId;
}

function simAppendUnique(cards: SimulatedCardState[], card: unknown): void {
  if (!card) return;
  const simulatedCard = card as SimulatedCardState;
  if (cards.some((entry) => simSameCard(entry, simulatedCard))) return;
  cards.push(simulatedCard);
}

function simCollectScopeCards(
  scope: object = {},
  self: SimulatedPlayerState | null | undefined,
  opponent: SimulatedPlayerState | null | undefined,
): SimulatedCardState[] {
  const zones = asArray(
    readProperty(scope, "zones") || readProperty(scope, "zone") || "field",
  ).filter((zone): zone is string => typeof zone === "string");
  const filters = simActionFilterFromConfig(scope);
  const cards: SimulatedCardState[] = [];
  for (const owner of simOwnersFromRule(
    readProperty(scope, "owner") || readProperty(scope, "player") || "self",
    self,
    opponent,
  )) {
    for (const zone of zones) {
      for (const card of getZoneCards(owner, zone)) {
        if (!matchesTargetFilters(card, filters, null)) continue;
        cards.push(card);
      }
    }
  }
  return cards;
}

function simMergedSelections(context: object | null | undefined) {
  if (!context) return mergeCanonicalSelections();
  const costSelections = readProperty(context, "costSelections");
  const targetSelections = readProperty(context, "targetSelections");
  const resolutionSelections = readProperty(context, "resolutionSelections");
  return mergeCanonicalSelections({
    costSelections: isObjectValue(costSelections) ? costSelections : null,
    targetSelections: isObjectValue(targetSelections) ? targetSelections : null,
    resolutionSelections: isObjectValue(resolutionSelections)
      ? resolutionSelections
      : null,
  });
}

function simSelectionValue(source: unknown, targetRef: string): unknown {
  return isObjectValue(source) ? readProperty(source, targetRef) : undefined;
}

function simSelectedCards(
  targetRef: string,
  activationContext: object = {},
): SimulatedCardState[] {
  const cards: SimulatedCardState[] = [];
  const respondingToChainLink = readProperty(
    activationContext,
    "respondingToChainLink",
  );
  const selectionSources = [
    simMergedSelections(activationContext),
    simMergedSelections(
      isObjectValue(respondingToChainLink) ? respondingToChainLink : null,
    ),
    readProperty(activationContext, "actionResults"),
    readProperty(activationContext, "_actionTargets"),
  ].filter(isObjectValue);
  for (const selections of selectionSources) {
    for (const card of asArray(simSelectionValue(selections, targetRef)).filter(Boolean)) {
      simAppendUnique(cards, card);
    }
  }
  return cards;
}

function simCollectTargetRefCards(
  targetRef: string,
  ctx: object = {},
  options: object = {},
): SimulatedCardState[] {
  const cards: SimulatedCardState[] = [];
  const ctxActionTargets = readProperty(ctx, "_actionTargets");
  const ctxSelections = readProperty(ctx, "selections");
  const actionResults = readProperty(options, "actionResults");
  const actionContext = readProperty(options, "actionContext");
  const activationContext = readProperty(options, "activationContext");
  const actionContextActionTargets = isObjectValue(actionContext)
    ? readProperty(actionContext, "_actionTargets")
    : undefined;
  const actionContextSelections = isObjectValue(actionContext)
    ? readProperty(actionContext, "selections")
    : undefined;
  const activationActionResults = isObjectValue(activationContext)
    ? readProperty(activationContext, "actionResults")
    : undefined;
  const activationActionContext = isObjectValue(activationContext)
    ? readProperty(activationContext, "actionContext")
    : undefined;
  const activationActionTargets = isObjectValue(activationActionContext)
    ? readProperty(activationActionContext, "_actionTargets")
    : undefined;
  const directSources = [
    simSelectionValue(ctx, targetRef),
    simSelectionValue(ctxActionTargets, targetRef),
    simSelectionValue(ctxSelections, targetRef),
    simSelectionValue(actionResults, targetRef),
    simSelectionValue(actionContext, targetRef),
    simSelectionValue(actionContextActionTargets, targetRef),
    simSelectionValue(actionContextSelections, targetRef),
    simSelectionValue(
      simMergedSelections(
        isObjectValue(activationContext) ? activationContext : null,
      ),
      targetRef,
    ),
    simSelectionValue(activationActionResults, targetRef),
    simSelectionValue(activationActionTargets, targetRef),
  ];
  for (const value of directSources) {
    for (const card of asArray(value).filter(Boolean)) {
      simAppendUnique(cards, card);
    }
  }
  for (const card of simSelectedCards(
    targetRef,
    isObjectValue(actionContext) ? actionContext : {},
  )) {
    simAppendUnique(cards, card);
  }
  for (const card of simSelectedCards(
    targetRef,
    isObjectValue(activationContext) ? activationContext : {},
  )) {
    simAppendUnique(cards, card);
  }
  return cards;
}

interface SimulatedActionView {
  type?: string;
  targetScope?: object | null;
  targetRef?: string | null;
  zones?: readonly string[];
  filters?: object | null;
  cardName?: string | null;
  cardType?: string | null;
  to?: string | null;
  toZone?: string | null;
  destination?: string | null;
  useDestroyed?: boolean;
  scope?: string | null;
}

interface SimulatedActivationAttemptView {
  card?: SimulatedCardState | null;
  effect?: EffectDefinition | null;
  controller?: SimulatedPlayerState | null;
}

interface SimulatedActivationContextView extends SimConditionContext {
  destroyed?: SimulatedCardState | null;
  activationAttempt?: SimulatedActivationAttemptView | null;
  effect?: EffectDefinition | null;
  player?: SimulatedPlayerState | null;
  context?: SimulatedActivationContextView | null;
}

function asSimulatedAction(value: unknown): SimulatedActionView | null {
  return isObjectValue(value) ? value as SimulatedActionView : null;
}

function simCollectDestroyCandidates(
  actions: unknown,
  activationPlayer: SimulatedPlayerState,
  activationOpponent: SimulatedPlayerState,
  activationContext: object = {},
  includeNested = true,
): SimulatedCardState[] {
  const cards: SimulatedCardState[] = [];
  const walkedActions = includeNested
    ? walkActionList(actions).visits.map((visit) => visit.action)
    : asArray(actions);
  for (const actionValue of walkedActions) {
    const action = asSimulatedAction(actionValue);
    if (!action) continue;
    if (action.type === "destroy") {
      if (action.targetScope) {
        cards.push(
          ...simCollectScopeCards(
            action.targetScope,
            activationPlayer,
            activationOpponent,
          ),
        );
      }
      cards.push(
        ...simSelectedCards(action.targetRef || "target", activationContext),
      );
    } else if (action.type === "destroy_targeted_cards") {
      if (action.targetRef) {
        cards.push(
          ...simSelectedCards(action.targetRef, activationContext),
        );
      } else {
        const { type: _actionType, ...targetAction } = action;
        cards.push(
          ...simCollectScopeCards(
            {
              owner: "opponent",
              zones: targetAction.zones || ["field", "spellTrap", "fieldSpell"],
              ...targetAction,
              filters: simActionFilterFromConfig(targetAction),
            },
            activationPlayer,
            activationOpponent,
          ),
        );
      }
    } else if (action.type === "destroy_cards_by_scope") {
      cards.push(
        ...simCollectScopeCards(
          action.targetScope || {},
          activationPlayer,
          activationOpponent,
        ),
      );
    } else if (action.type === "mirror_force_destroy_all") {
      cards.push(
        ...getZoneCards(activationOpponent, "field").filter(
          (card) =>
            card?.cardKind === "monster" &&
            card.position === "attack" &&
            !card.isFacedown,
        ),
      );
    }
  }
  return cards;
}

function simMoveLeavesField(action: SimulatedActionView | null | undefined): boolean {
  const toZone = action?.to || action?.toZone || action?.destination || null;
  return (
    typeof toZone === "string" &&
    [
      "graveyard",
      "hand",
      "deck",
      "extraDeck",
      "banished",
      "banish",
    ].includes(toZone)
  );
}

function simMoveBanishes(action: SimulatedActionView | null | undefined): boolean {
  const toZone = action?.to || action?.toZone || action?.destination || null;
  return toZone === "banished" || toZone === "banish";
}

function simCollectGraveyardBanishCandidates(
  action: SimulatedActionView,
  activationPlayer: SimulatedPlayerState,
): SimulatedCardState[] {
  const filters = { ...(action.filters || {}) };
  if (action.cardName && readProperty(filters, "name") === undefined) {
    Reflect.set(filters, "name", action.cardName);
  }
  if (action.cardType && readProperty(filters, "type") === undefined) {
    Reflect.set(filters, "type", action.cardType);
  }
  return getZoneCards(activationPlayer, "graveyard").filter((card) =>
    matchesTargetFilters(card, filters, null)
  );
}

function simCollectBanishCandidates(
  actions: unknown,
  activationPlayer: SimulatedPlayerState,
  activationOpponent: SimulatedPlayerState,
  activationContext: SimulatedActivationContextView = {},
): SimulatedCardState[] {
  const cards: SimulatedCardState[] = [];
  for (const actionValue of walkActionList(actions).visits.map(
    (visit) => visit.action,
  )) {
    const action = asSimulatedAction(actionValue);
    if (!action) continue;
    if (
      action.type === "banish" ||
      action.type === "banish_destroyed_monster" ||
      action.type === "banish_and_buff"
    ) {
      if (action.targetScope) {
        for (const card of simCollectScopeCards(
          action.targetScope,
          activationPlayer,
          activationOpponent,
        )) {
          simAppendUnique(cards, card);
        }
      }
      if (action.type === "banish_destroyed_monster" || action.useDestroyed === true) {
        simAppendUnique(cards, activationContext.destroyed);
      }
      for (const card of simSelectedCards(
        action.targetRef || "target",
        activationContext,
      )) {
        simAppendUnique(cards, card);
      }
    } else if (action.type === "banish_card_from_graveyard") {
      for (const card of simCollectGraveyardBanishCandidates(
        action,
        activationPlayer,
      )) {
        simAppendUnique(cards, card);
      }
    } else if (action.type === "banish_all_graveyard_and_burn") {
      for (const card of simCollectScopeCards(
        {
          owner: action.scope || "self",
          zones: ["graveyard"],
        },
        activationPlayer,
        activationOpponent,
      )) {
        simAppendUnique(cards, card);
      }
    } else if (action.type === "move" && simMoveBanishes(action)) {
      if (action.targetScope) {
        for (const card of simCollectScopeCards(
          action.targetScope,
          activationPlayer,
          activationOpponent,
        )) {
          simAppendUnique(cards, card);
        }
      }
      for (const card of simSelectedCards(
        action.targetRef || "target",
        activationContext,
      )) {
        simAppendUnique(cards, card);
      }
    }
  }
  return cards;
}

function simCollectLeaveFieldCandidates(
  actions: unknown,
  activationPlayer: SimulatedPlayerState,
  activationOpponent: SimulatedPlayerState,
  activationContext: SimulatedActivationContextView = {},
): SimulatedCardState[] {
  const cards: SimulatedCardState[] = [];
  for (const actionValue of walkActionList(actions).visits.map(
    (visit) => visit.action,
  )) {
    const action = asSimulatedAction(actionValue);
    if (!action) continue;
    for (const card of simCollectDestroyCandidates(
      [action],
      activationPlayer,
      activationOpponent,
      activationContext,
      false,
    )) {
      simAppendUnique(cards, card);
    }
    if (
      action.type === "banish" ||
      action.type === "banish_destroyed_monster" ||
      action.type === "return_to_hand" ||
      (action.type === "move" && simMoveLeavesField(action))
    ) {
      if (action.targetScope) {
        for (const card of simCollectScopeCards(
          action.targetScope,
          activationPlayer,
          activationOpponent,
        )) {
          simAppendUnique(cards, card);
        }
      }
      for (const card of simSelectedCards(
        action.targetRef || "target",
        activationContext,
      )) {
        simAppendUnique(cards, card);
      }
    } else if (action.type === "shuffle_opponent_field_to_deck") {
      for (const card of getZoneCards(activationOpponent, "field")) {
        simAppendUnique(cards, card);
      }
    }
  }
  return cards;
}

interface SimActivationConditionView {
  activationPlayer?: "self" | "opponent" | string;
  affectedPlayer?: string;
  cardOwner?: string;
  owner?: string;
  destroyedCardFilters?: object;
  destroyedCardZones?: readonly string[];
  banishedCardFilters?: object;
  banishedCardZones?: readonly string[];
  filters?: object;
  zones?: readonly string[];
  fromZones?: readonly string[];
  minCount?: number;
  count?: number;
  cardRef?: string;
  targetRef?: string;
}

interface SimActivationEvaluationContext extends SimConditionContext {
  actionContext?: SimulatedActivationContextView | null;
}

interface SimActivationEvaluationOptions extends SimConditionOptions {
  actionContext?: SimulatedActivationContextView | null;
  activationContext?: SimulatedActivationContextView | null;
  card?: SimulatedCardState | null;
  effect?: EffectDefinition | null;
}

interface SimConditionEvaluationOptions extends SimActivationEvaluationOptions {
  strategy?: SimConditionStrategy | null;
  evaluateSimulatedConditions?: SimConditionEvaluator;
}

interface SimContextValueReference {
  key?: string | null;
  path?: string | null;
}

interface SimConditionView
  extends PlayerMatchingCondition,
    EventCardCondition,
    SimActivationConditionView {
  any_of?: readonly unknown[];
  conditions?: readonly unknown[];
  empty_field?: boolean;
  control_card?: boolean;
  control_card_filters?: object;
  path?: string | null;
  defaultValue?: unknown;
  valueFromContext?: string | SimContextValueReference | null;
  value?: unknown;
  amount?: unknown;
  defaultExpectedValue?: unknown;
  counterType?: string;
  op?: SimNumericOperator;
  operator?: SimNumericOperator;
  max?: number;
  leftOwner?: string;
  rightOwner?: string;
  leftFilters?: object;
  rightFilters?: object;
  excludeSource?: boolean;
  requireFaceup?: boolean;
  stateKey?: string | null;
  key?: string | null;
  property?: string | null;
  sourceFilters?: object;
  sourceEffectId?: string | null;
  sourceRef?: string | null;
  attackerType?: string | null;
  monsterType?: string | null;
  cardType?: string | null;
  race?: string | null;
  minMatchingCostCount?: number;
  requireCurrentFieldPresence?: boolean;
}

function asSimCondition(value: unknown): SimConditionView | null {
  return isObjectValue(value) ? value as SimConditionView : null;
}

function simActivationWouldDestroyMatchingCards(
  condition: SimActivationConditionView,
  ctx: SimActivationEvaluationContext,
  options: SimActivationEvaluationOptions,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
): boolean {
  const activationContext =
    options.actionContext ||
    ctx.actionContext ||
    options.activationContext?.context ||
    {};
  const activationAttempt = activationContext.activationAttempt || null;
  const activatedCard = firstSimulatedCard(
    activationAttempt?.card || activationContext.card || options.card || null,
  );
  const effect =
    activationAttempt?.effect || activationContext.effect || options.effect || null;
  const activationPlayer =
    activationAttempt?.controller || activationContext.player || null;
  const activationPlayerId =
    activationPlayer?.id || activatedCard?.controller || activatedCard?.owner || null;
  const activationOwner =
    activationPlayerId === self?.id ? self : activationPlayerId === opponent?.id ? opponent : null;
  if (!activationOwner || !effect) return false;
  if (condition.activationPlayer === "opponent" && activationOwner !== opponent) {
    return false;
  }
  if (condition.activationPlayer === "self" && activationOwner !== self) {
    return false;
  }
  const activationOpponent = activationOwner === self ? opponent : self;
  const filters = condition.destroyedCardFilters || condition.filters || {};
  const affectedOwners = simOwnersFromRule(
    condition.affectedPlayer ||
      condition.cardOwner ||
      condition.owner ||
      "any",
    self,
    opponent,
  );
  const minCount = Math.max(1, Number(condition.minCount ?? condition.count ?? 1));
  const matching = simCollectDestroyCandidates(
    effect.actions || [],
    activationOwner,
    activationOpponent,
    activationContext,
  ).filter(
    (card) =>
      simCardInAllowedZones(
        card,
        condition.destroyedCardZones || condition.zones,
        affectedOwners,
      ) && matchesTargetFilters(card, filters, null),
  );
  return matching.length >= minCount;
}

function simActivationWouldBanishMatchingCards(
  condition: SimActivationConditionView,
  ctx: SimActivationEvaluationContext,
  options: SimActivationEvaluationOptions,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
): boolean {
  const activationContext =
    options.actionContext ||
    ctx.actionContext ||
    options.activationContext?.context ||
    {};
  const activationAttempt = activationContext.activationAttempt || null;
  const activatedCard = firstSimulatedCard(
    activationAttempt?.card || activationContext.card || options.card || null,
  );
  const effect =
    activationAttempt?.effect || activationContext.effect || options.effect || null;
  const activationPlayer =
    activationAttempt?.controller || activationContext.player || null;
  const activationPlayerId =
    activationPlayer?.id || activatedCard?.controller || activatedCard?.owner || null;
  const activationOwner =
    activationPlayerId === self?.id ? self : activationPlayerId === opponent?.id ? opponent : null;
  if (!activationOwner || !effect) return false;
  if (condition.activationPlayer === "opponent" && activationOwner !== opponent) {
    return false;
  }
  if (condition.activationPlayer === "self" && activationOwner !== self) {
    return false;
  }
  const activationOpponent = activationOwner === self ? opponent : self;
  const filters = condition.banishedCardFilters || condition.filters || {};
  const zones =
    condition.banishedCardZones ||
    condition.fromZones ||
    condition.zones || [
      "field",
      "spellTrap",
      "fieldSpell",
      "graveyard",
    ];
  const affectedOwners = simOwnersFromRule(
    condition.affectedPlayer || condition.cardOwner || condition.owner || "self",
    self,
    opponent,
  );
  const minCount = Math.max(1, Number(condition.minCount ?? condition.count ?? 1));
  const matching = simCollectBanishCandidates(
    effect.actions || [],
    activationOwner,
    activationOpponent,
    activationContext,
  ).filter(
    (card) =>
      simCardInAllowedZones(card, zones, affectedOwners) &&
      matchesTargetFilters(card, filters, null),
  );
  return matching.length >= minCount;
}

function simActivationWouldMakeCardLeaveField(
  condition: SimActivationConditionView,
  ctx: SimActivationEvaluationContext,
  options: SimActivationEvaluationOptions,
  self: SimulatedPlayerState,
  opponent: SimulatedPlayerState,
): boolean {
  const activationContext =
    options.actionContext ||
    ctx.actionContext ||
    options.activationContext?.context ||
    {};
  const activationAttempt = activationContext.activationAttempt || null;
  const activatedCard = firstSimulatedCard(
    activationAttempt?.card || activationContext.card || options.card || null,
  );
  const effect =
    activationAttempt?.effect || activationContext.effect || options.effect || null;
  const activationPlayer =
    activationAttempt?.controller || activationContext.player || null;
  const activationPlayerId =
    activationPlayer?.id || activatedCard?.controller || activatedCard?.owner || null;
  const activationOwner =
    activationPlayerId === self?.id ? self : activationPlayerId === opponent?.id ? opponent : null;
  if (!activationOwner || !effect) return false;
  if (condition.activationPlayer === "opponent" && activationOwner !== opponent) {
    return false;
  }
  if (condition.activationPlayer === "self" && activationOwner !== self) {
    return false;
  }
  const watched = resolveConditionSource(
    ctx,
    options,
    condition.cardRef || condition.targetRef || "self",
  );
  if (!watched) return false;
  const activationOpponent = activationOwner === self ? opponent : self;
  const activeZones = condition.fromZones || condition.zones || [
    "field",
    "spellTrap",
    "fieldSpell",
  ];
  if (!simCardInAllowedZones(watched, activeZones, [self, opponent])) {
    return false;
  }
  const candidates = simCollectLeaveFieldCandidates(
    effect.actions || [],
    activationOwner,
    activationOpponent,
    activationContext,
  ).filter(
    (card) =>
      simSameCard(card, watched) &&
      simCardInAllowedZones(card, activeZones, [self, opponent]) &&
      matchesTargetFilters(card, condition.filters || {}, null),
  );
  return candidates.length > 0;
}

export function evaluateSimulatedConditions(
  conditions: unknown,
  ctx?: object,
): boolean;
export function evaluateSimulatedConditions(
  conditions: unknown,
  ctx: SimConditionEvaluationContext = {},
): boolean {
  const list = conditionsArray(conditions);
  if (list.length === 0) return true;
  const state = (ctx.state || ctx.game || {}) as SimConditionStateView;
  const { self, opponent } = getPerspectivePlayers(state, ctx.selfId || "bot");
  const options = ctx.options || {};
  const custom =
    options.evaluateSimulatedConditions ||
    options.strategy?.evaluateSimulatedConditions?.bind(options.strategy);
  if (typeof custom === "function") {
    const result = custom(conditions, ctx);
    if (typeof result === "boolean") return result;
  }

  return list.every((conditionValue) => {
    const condition = asSimCondition(conditionValue);
    if (!condition) return true;
    if (condition.type === "any_of" || Array.isArray(condition.any_of)) {
      const optionsList = condition.conditions || condition.any_of || [];
      return optionsList.some((entry) =>
        evaluateSimulatedConditions(entry, ctx)
      );
    }
    const owner = condition.owner === "opponent" ? opponent : self;
    if (condition.type === "context_number_compare") {
      const rawCurrent = readSimContextPath(
        ctx,
        options,
        condition.key || condition.path,
      );
      const current = Number(rawCurrent ?? condition.defaultValue ?? 0);
      const valueFromContext =
        typeof condition.valueFromContext === "string"
          ? condition.valueFromContext
          : condition.valueFromContext?.key || condition.valueFromContext?.path;
      const rawExpected = valueFromContext
        ? readSimContextPath(ctx, options, valueFromContext)
        : undefined;
      const expected = Number(
        rawExpected ??
          condition.value ??
          condition.amount ??
          condition.defaultExpectedValue ??
          0,
      );
      return (
        Number.isFinite(current) &&
        Number.isFinite(expected) &&
        compareSimContextNumbers(
          current,
          condition.op || condition.operator || "gt",
          expected,
        )
      );
    }
    if (condition.type === "source_counters_at_least") {
      const sourceCard = ctx.sourceCard || options.sourceCard;
      return (
        getCounterValue(sourceCard, condition.counterType || "counter") >=
        (condition.min || 0)
      );
    }
    if (condition.type === "has_stored_blueprint") {
      const sourceCard = ctx.sourceCard || options.sourceCard;
      return getStoredBlueprints(sourceCard).length > 0;
    }
    if (condition.type === "empty_field" || condition.empty_field) {
      return (owner?.field || []).filter((card) => card?.cardKind === "monster")
        .length === 0;
    }
    if (condition.type === "control_card" || condition.control_card) {
      return playerControlsMatching(owner, condition);
    }
    if (
      condition.type === "control_card_filters" ||
      condition.control_card_filters
    ) {
      const {
        type: _conditionType,
        owner: _owner,
        zone: _zone,
        zones: _zones,
        min: _min,
        max: _max,
        reason: _reason,
        ...directFilters
      } = condition;
      const filters = {
        ...directFilters,
        ...(condition.control_card_filters || condition.filters || {}),
      };
      const zones = asArray(condition.zones || condition.zone || "field");
      const min = typeof condition.min === "number" && Number.isFinite(condition.min)
        ? condition.min
        : typeof condition.max === "number" && Number.isFinite(condition.max)
          ? 0
          : 1;
      const max =
        typeof condition.max === "number" && Number.isFinite(condition.max)
          ? condition.max
          : null;
      const sourceCard = resolveConditionSource(ctx, options, "self");
      const count = zones.reduce(
        (sum, zone) =>
          sum +
          getZoneCards(owner, zone).filter((card) => {
            if (
              condition.excludeSource === true &&
              simSameCard(card, sourceCard)
            ) {
              return false;
            }
            return matchesTargetFilters(card, filters, null);
          }).length,
        0,
      );
      return count >= min && (max === null || count <= max);
    }
    if (condition.type === "control_card_max") {
      const zones = asArray(condition.zones || condition.zone || "field");
      const max =
        typeof condition.max === "number" && Number.isFinite(condition.max)
          ? condition.max
          : 0;
      const filters = condition.filters || {};
      const count = zones.reduce(
        (sum, zone) =>
          sum +
          getZoneCards(owner, zone).filter((card) =>
            matchesTargetFilters(card, filters, null)
          ).length,
        0,
      );
      return count <= max;
    }
    if (condition.type === "destroyed_card_matches_declared_value") {
      const sourceCard = ctx.sourceCard || options.sourceCard;
      const declaration = readSimDeclaration(
        sourceCard,
        condition.stateKey || condition.key,
      );
      const destroyedCard =
        ctx.destroyed || options.destroyed || options.actionContext?.destroyed;
      const property = condition.property || "type";
      if (!declaration || !destroyedCard) return false;
      const destroyedValue = isObjectValue(destroyedCard)
        ? readProperty(destroyedCard, property)
        : undefined;
      const values = Array.isArray(destroyedValue)
        ? destroyedValue
        : [destroyedValue];
      return values.includes(declaration.value);
    }
    if (condition.type === "battle_destroyer_matches_filters") {
      const battleDestroyers = asArray(
        ctx.battleDestroyers ||
          options.battleDestroyers ||
          options.actionContext?.battleDestroyers ||
          ctx.battleDestroyer ||
          options.battleDestroyer ||
          options.attacker ||
          options.actionContext?.attacker,
      ).filter(Boolean);
      const expectedOwner =
        condition.owner === "opponent"
          ? opponent
          : condition.owner === "any"
            ? null
            : self;
      return battleDestroyers.some((card) => {
        if (!card) return false;
        if (expectedOwner) {
          const owner = getZoneCards(expectedOwner, "field").includes(card)
            ? expectedOwner
            : card.controller === expectedOwner.id ||
                card.owner === expectedOwner.id
              ? expectedOwner
              : null;
          if (owner !== expectedOwner) return false;
        }
        return matchesTargetFilters(card, condition.filters || {}, null);
      });
    }
    if (condition.type === "battle_participant_matches_filters") {
      const ownerId =
        condition.owner === "opponent"
          ? opponent?.id
          : condition.owner === "any"
            ? null
            : self?.id;
      const participants = ownerId
        ? [battleParticipantForOwner(ctx, options, ownerId)]
        : [
            ctx.attacker || options.attacker || options.actionContext?.attacker,
            ctx.defender ||
              ctx.target ||
              options.defender ||
              options.target ||
              options.actionContext?.defender ||
              options.actionContext?.target,
          ].filter(Boolean);
      return participants.some((card) =>
        matchesTargetFilters(card, condition.filters || {}, null)
      );
    }
    if (condition.type === "battle_opponent_matches_declared_value") {
      const sourceCard = ctx.sourceCard || options.sourceCard;
      const declaration = readSimDeclaration(
        sourceCard,
        condition.stateKey || condition.key,
      );
      const battleOpponent = battleParticipantForOwner(
        ctx,
        options,
        opponent?.id,
      );
      const property = condition.property || "type";
      if (!declaration || !battleOpponent) return false;
      const values = asArray(readProperty(battleOpponent, property));
      return values.includes(declaration.value);
    }
    if (condition.type === "field_card_count") {
      const ownerList =
        condition.owner === "opponent"
          ? [opponent]
          : condition.owner === "any" || condition.owner === "both"
            ? [self, opponent]
            : [self];
      const zones = asArray(condition.zones || condition.zone || "field");
      const filters = condition.filters || {};
      const count = ownerList.filter(Boolean).reduce(
        (sum, player) =>
          sum +
          zones.reduce(
            (zoneSum, zone) =>
              zoneSum +
              getZoneCards(player, zone).filter((card) => {
                if (condition.requireFaceup === true && card?.isFacedown) {
                  return false;
                }
                if (
                  condition.excludeSource === true &&
                  simSameCard(card, resolveConditionSource(ctx, options, "self"))
                ) {
                  return false;
                }
                return matchesTargetFilters(card, filters, null);
              }).length,
            0,
          ),
        0,
      );
      if (condition.count !== undefined) return count === condition.count;
      if (condition.min !== undefined && count < condition.min) return false;
      if (condition.max !== undefined && count > condition.max) return false;
      return true;
    }
    if (condition.type === "field_card_count_comparison") {
      const zones = asArray(condition.zones || condition.zone || "field");
      const ownersFor = (ownerRule: string | undefined) =>
        ownerRule === "opponent"
          ? [opponent]
          : ownerRule === "any" || ownerRule === "both"
            ? [self, opponent]
            : [self];
      const countFor = (ownerRule: string | undefined, filters: object) =>
        ownersFor(ownerRule)
          .filter(Boolean)
          .reduce(
            (total, player) =>
              total +
              zones.reduce(
                (zoneTotal, zone) =>
                  zoneTotal +
                  getZoneCards(player, zone).filter((card) => {
                    if (condition.requireFaceup === true && card?.isFacedown) {
                      return false;
                    }
                    if (
                      condition.excludeSource === true &&
                      simSameCard(
                        card,
                        resolveConditionSource(ctx, options, "self"),
                      )
                    ) {
                      return false;
                    }
                    return matchesTargetFilters(card, filters || {}, null);
                  }).length,
                0,
              ),
            0,
          );
      const leftCount = countFor(
        condition.leftOwner || "opponent",
        condition.leftFilters || condition.filters || {},
      );
      const rightCount = countFor(
        condition.rightOwner || "self",
        condition.rightFilters || condition.filters || {},
      );
      const operator = condition.operator || "gt";
      if (operator === "eq" || operator === "===") return leftCount === rightCount;
      if (operator === "neq" || operator === "!=" || operator === "!==") {
        return leftCount !== rightCount;
      }
      if (operator === "lt" || operator === "<") return leftCount < rightCount;
      if (operator === "lte" || operator === "<=") return leftCount <= rightCount;
      if (operator === "gte" || operator === ">=") return leftCount >= rightCount;
      return leftCount > rightCount;
    }
    if (condition.type === "activation_would_destroy_cards_matching_filters") {
      return simActivationWouldDestroyMatchingCards(
        condition,
        ctx,
        options,
        self,
        opponent,
      );
    }
    if (condition.type === "activation_would_banish_cards_matching_filters") {
      return simActivationWouldBanishMatchingCards(
        condition,
        ctx,
        options,
        self,
        opponent,
      );
    }
    if (condition.type === "activation_would_make_card_leave_field") {
      return simActivationWouldMakeCardLeaveField(
        condition,
        ctx,
        options,
        self,
        opponent,
      );
    }
    if (condition.type === "event_card_matches_filters") {
      const card = resolveEventCardByRef(condition, ctx, options);
      const ownerKey = condition.owner || "any";
      if (ownerKey !== "any") {
        const expectedOwner = ownerKey === "opponent" ? opponent : self;
        const eventOwnerId =
          readPlayerId(options.actionContext?.destroyedOwner) ||
          card?.controller ||
          card?.owner;
        if (!expectedOwner || eventOwnerId !== expectedOwner.id) return false;
      }
      return matchesTargetFilters(card, condition.filters || {}, null);
    }
    if (condition.type === "targetRefMatchesFilters") {
      const targetRef = condition.targetRef || condition.cardRef || "target";
      const filters = simActionFilterFromConfig({
        ...condition,
        type: undefined,
      });
      const min = Number.isFinite(Number(condition.min ?? condition.count))
        ? Number(condition.min ?? condition.count)
        : 1;
      const max = Number.isFinite(Number(condition.max))
        ? Number(condition.max)
        : null;
      const matching = simCollectTargetRefCards(targetRef, ctx, options).filter(
        (card) =>
          simCardInAllowedZones(card, condition.zones || condition.zone, [
            self,
            opponent,
          ]) && matchesTargetFilters(card, filters, null),
      );
      return matching.length >= min && (max === null || matching.length <= max);
    }
    if (
      condition.type === "event_card_matches_declared_value_from_effect_sources"
    ) {
      const card = resolveEventCardByRef(condition, ctx, options);
      if (!card) return false;
      const property = condition.property || "type";
      const sourceFilters = condition.sourceFilters || {};
      const stateKey = condition.stateKey || condition.key || null;
      const owners =
        condition.owner === "opponent"
          ? [opponent]
          : condition.owner === "any" || condition.owner === "both"
            ? [self, opponent]
            : [self];

      const activeMatch = owners.filter(Boolean).some((player) =>
        activeDeclarationSources(player).some(
          (source) =>
            matchesTargetFilters(source, sourceFilters, null) &&
            declaredValuesMatchCard(
              state,
              source.declaredValues,
              card,
              property,
              stateKey,
            ),
        ),
      );
      if (activeMatch) return true;

      const temporaryEffects = Array.isArray(state.temporaryEventEffects)
        ? state.temporaryEventEffects
        : [];
      return owners.filter(Boolean).some((player) =>
        temporaryEffects.some((entry) => {
          if (!entry || entry.ownerId !== player.id) return false;
          if (
            typeof entry.expiresOnTurn === "number" &&
            Number.isFinite(entry.expiresOnTurn) &&
            Number(state.turnCounter || 0) > entry.expiresOnTurn
          ) {
            return false;
          }
          const source = buildSimTemporarySource(entry);
          return (
            matchesTargetFilters(source as SimulatedCardState, sourceFilters, null) &&
            declaredValuesMatchCard(
              state,
              entry.declaredValues,
              card,
              property,
              stateKey,
            )
          );
        }),
      );
    }
    if (condition.type === "attacker_matches") {
      const attacker =
        ctx.attacker || options.attacker || options.actionContext?.attacker;
      if (!attacker) return false;
      const {
        type: _conditionType,
        owner: ownerRule = "any",
        reason: _reason,
        attackerType,
        monsterType,
        cardType,
        race,
        ...filters
      } = condition;
      const attackerOwner = [self, opponent].find(
        (candidate) =>
          !!candidate &&
          ((Array.isArray(candidate.field) &&
            candidate.field.includes(attacker)) ||
            attacker.controller === candidate.id ||
            attacker.owner === candidate.id),
      );
      if (ownerRule === "self" && attackerOwner !== self) return false;
      if (ownerRule === "opponent" && attackerOwner === self) return false;

      const requiredType = attackerType || monsterType || cardType || race;
      return matchesTargetFilters(
        attacker,
        requiredType === undefined ? filters : { ...filters, type: requiredType },
        null,
      );
    }
    if (condition.type === "summoned_card_has_marker") {
      const summonedCard =
        ctx.summonedCard ||
        options.summonedCard ||
        options.actionContext?.summonedCard;
      const key = condition.key || condition.stateKey;
      const marker = key ? summonedCard?.effectMarkers?.[key] : null;
      if (!marker) return false;
      if (
        typeof marker.expiresOnTurn === "number" &&
        Number.isFinite(marker.expiresOnTurn) &&
        Number(state.turnCounter || 0) > marker.expiresOnTurn
      ) {
        return false;
      }
      if (
        condition.sourceEffectId &&
        marker.sourceEffectId !== condition.sourceEffectId
      ) {
        return false;
      }
      if (condition.sourceRef) {
        const sourceCard = resolveConditionSource(
          ctx,
          options,
          condition.sourceRef,
        );
        if (!markerMatchesSource(marker, sourceCard)) return false;
      }
      return true;
    }
    if (condition.type === "source_has_marker") {
      const sourceCard =
        ctx.sourceCard ||
        ctx.source ||
        options.sourceCard ||
        options.actionContext?.source;
      const key = condition.key || condition.stateKey;
      const marker = key ? sourceCard?.effectMarkers?.[key] : null;
      if (!marker) return false;
      if (
        typeof marker.expiresOnTurn === "number" &&
        Number.isFinite(marker.expiresOnTurn) &&
        Number(state.turnCounter || 0) > marker.expiresOnTurn
      ) {
        return false;
      }
      if (
        condition.sourceEffectId &&
        marker.sourceEffectId !== condition.sourceEffectId
      ) {
        return false;
      }
      if (
        typeof condition.minMatchingCostCount === "number" &&
        Number.isFinite(condition.minMatchingCostCount) &&
        Number(marker.matchingCostCount || 0) < condition.minMatchingCostCount
      ) {
        return false;
      }
      if (condition.requireCurrentFieldPresence === true) {
        if (
          !sourceCard?.fieldPresenceId ||
          !marker.fieldPresenceId ||
          marker.fieldPresenceId !== sourceCard.fieldPresenceId
        ) {
          return false;
        }
      }
      return true;
    }
    return true;
  });
}

