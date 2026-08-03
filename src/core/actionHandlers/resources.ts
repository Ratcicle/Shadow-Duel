/**
 * resources.js
 *
 * Handlers for resource management (LP, draw, search, upkeep).
 * Moved from ActionHandlers.js with identical behavior.
 */

import { isAI } from "../Player.js";
import { cardMatchesKind } from "../Card.js";
import type {
  ActionOf,
  ActionOwner,
  SelectionCount,
} from "../contracts/actions.js";
import type {
  ActionRuntimeCard,
  ActionRuntimeGamePort,
  ActionRuntimePlayer,
  ActionHandlerEnginePort,
  EffectContext,
  MaybePromise,
  NeedsSelectionResult,
  ResolvedTargetMap,
} from "../contracts/actionRuntime.js";
import {
  readContextValue,
  writeContextValue,
} from "../contracts/actionRuntime.js";
import type { CardFilter } from "../contracts/effects.js";
import type { ZoneInput } from "../contracts/zones.js";
import { getCardDisplayName, getCounterDisplayLabel, getUIText } from "../i18n.js";
import {
  getUI,
  collectZoneCandidates,
  selectCardsFromZone,
  summonFromHandCore,
} from "./shared.js";

type SearchAction = ActionOf<"add_from_zone_to_hand" | "search_any">;
type DiscardAction = ActionOf<"discard_from_hand">;
type FollowupSearchAction = ActionOf<
  "search_then_optional_special_summon_from_hand"
>;
type UpkeepAction = ActionOf<"upkeep_pay_or_send_to_grave">;

interface LegacyFieldCounterFilter {
  readonly requireFaceup?: boolean;
  readonly cardKind?: CardFilter["cardKind"];
  readonly archetype?: string;
  readonly type?: string;
  readonly attribute?: string;
  readonly name?: string;
  readonly subtype?: string;
}

interface RuntimeSearchFilter extends CardFilter {
  readonly excludeCards?: readonly ActionRuntimeCard[];
  readonly excludeInstanceId?: string | number;
  readonly excludeInstanceIds?: readonly (string | number)[];
}

type MutableRuntimeSearchFilter = {
  -readonly [Key in keyof RuntimeSearchFilter]: RuntimeSearchFilter[Key];
};

interface SelectionRange {
  readonly min: number;
  readonly max: number;
}

interface ZoneSelectionCandidate {
  idx: number;
  key: string;
  name: string;
  owner: string;
  controller: string;
  zone: string;
  zoneIndex: number;
  position: string;
  atk?: number;
  def?: number;
  level?: number;
  cardKind?: ActionRuntimeCard["cardKind"];
  cardRef: ActionRuntimeCard;
}

interface SelectionContractData {
  readonly kind: string;
  readonly requirementId: string;
  readonly decorated: readonly ZoneSelectionCandidate[];
  readonly selectionContract: object;
}

interface AddToHandContractContext {
  readonly player: ActionRuntimePlayer;
  readonly game: ActionRuntimeGamePort;
  readonly sourceZone: string;
}

interface DiscardContractContext {
  readonly affectedPlayer: ActionRuntimePlayer;
  readonly game: ActionRuntimeGamePort;
}

interface MarkerConfig {
  readonly key?: string;
  readonly duration?: string;
  readonly durationTurns?: number;
  readonly expiresOnTurn?: number;
  readonly bindToSource?: boolean;
  readonly sourceEffectId?: string;
}

interface AutoSelectionResult {
  readonly ok?: boolean;
  readonly selections?: Record<string, readonly string[] | undefined>;
}

interface LegacyBotPreferenceRule {
  readonly ifHandHas?: string;
  readonly prefer: string;
}

interface UpkeepMoveOptions {
  readonly sourceCard?: ActionRuntimeCard | null;
  readonly effectId?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRuntimeCard(value: unknown): value is ActionRuntimeCard {
  return isRecord(value) && typeof value.name === "string";
}

function isMoveSuccess(value: unknown): boolean {
  return !isRecord(value) || value.success !== false;
}

function isAutoSelectionResult(value: unknown): value is AutoSelectionResult {
  return isRecord(value);
}

function isPromiseLikeBoolean(
  value: MaybePromise<boolean>,
): value is PromiseLike<boolean> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "then") === "function"
  );
}

function readString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const result = Reflect.get(value, key);
  return typeof result === "string" ? result : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const result = Reflect.get(value, key);
  return typeof result === "number" ? result : undefined;
}

function readStringArray(value: unknown, key: string): string[] {
  if (!isRecord(value)) return [];
  const result = Reflect.get(value, key);
  return Array.isArray(result)
    ? result.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readMarkerConfig(value: unknown): MarkerConfig | null {
  if (!isRecord(value)) return null;
  const marker = Reflect.get(value, "markAddedCards");
  return isRecord(marker) ? marker : null;
}

function readBotPreferenceRules(value: unknown): LegacyBotPreferenceRule[] {
  if (!isRecord(value)) return [];
  const rules = Reflect.get(value, "botPrefer");
  if (!Array.isArray(rules)) return [];
  return rules.filter(
    (rule): rule is LegacyBotPreferenceRule =>
      isRecord(rule) && typeof rule.prefer === "string",
  );
}

function getPlayerZoneCards(
  player: ActionRuntimePlayer,
  zone: ZoneInput,
): ActionRuntimeCard[] {
  const normalizedZone = zone === "banish" ? "banished" : zone;
  if (normalizedZone === "fieldSpell") {
    return player.fieldSpell ? [player.fieldSpell] : [];
  }
  const value = Reflect.get(player, normalizedZone);
  return Array.isArray(value) ? value.filter(isRuntimeCard) : [];
}

async function emitLpGainEvent(
  game: ActionRuntimeGamePort,
  player: ActionRuntimePlayer,
  sourceCard: ActionRuntimeCard | null | undefined,
  before: number,
): Promise<boolean> {
  const gained = Math.max(0, (player?.lp || 0) - before);
  if (gained <= 0) return false;

  const payload = {
    player,
    sourceCard,
    lpGained: gained,
    before,
    after: player.lp,
  };

  if (typeof game?.emit === "function") {
    await game.emit("lp_change", payload);
  } else {
    game?.notify?.("lp_change", payload);
  }

  return true;
}

function getScopedPlayers(
  ctx: EffectContext,
  owner: ActionOwner = "self",
): ActionRuntimePlayer[] {
  if (owner === "opponent") {
    return ctx.opponent ? [ctx.opponent] : [];
  }
  if (owner === "any" || owner === "both" || owner === "either") {
    return [ctx.player, ctx.opponent].filter(
      (entry): entry is ActionRuntimePlayer => entry != null,
    );
  }
  return ctx.player ? [ctx.player] : [];
}

function getFieldCounterZoneCards(
  player: ActionRuntimePlayer,
  zone: ZoneInput,
): ActionRuntimeCard[] {
  if (!player || !zone) return [];
  if (zone === "fieldSpell") {
    return player.fieldSpell ? [player.fieldSpell] : [];
  }
  return getPlayerZoneCards(player, zone);
}

function getCardInstanceId(
  card: ActionRuntimeCard | null | undefined,
): string | number | null {
  return card?.instanceId ?? card?._instanceId ?? card?.uuid ?? card?.simInstanceId ?? null;
}

function getCardsFromTargetRefs(
  refs: string | readonly (string | null | undefined)[],
  targets: ResolvedTargetMap,
): ActionRuntimeCard[] {
  const targetRefs = (Array.isArray(refs) ? refs : [refs]).filter(
    (ref): ref is string => typeof ref === "string" && ref.length > 0,
  );
  return targetRefs
    .filter(Boolean)
    .flatMap((ref) => {
      const value = targets[ref];
      const entries = Array.isArray(value) ? value : value ? [value] : [];
      return entries.flatMap((entry) => {
        if (isRuntimeCard(entry)) return [entry];
        if (isRecord(entry) && isRuntimeCard(entry.card)) return [entry.card];
        return [];
      });
    });
}

function storeActionResultCards(
  action: SearchAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  cards: readonly ActionRuntimeCard[],
  fallbackKey: string | null = null,
): void {
  const resultKey =
    readString(action, "resultRef") ||
    readString(action, "storeResultAs") ||
    fallbackKey;
  if (!resultKey) return;
  const storedCards = Array.isArray(cards) ? cards.filter(Boolean) : [];
  if (!ctx || typeof ctx !== "object") return;
  if (!ctx._actionTargets || typeof ctx._actionTargets !== "object") {
    ctx._actionTargets = {};
  }
  ctx._actionTargets[resultKey] = storedCards;
  if (targets && typeof targets === "object") {
    targets[resultKey] = storedCards;
  }
}

function cardMatchesFieldCounterFilters(
  card: ActionRuntimeCard,
  filters: LegacyFieldCounterFilter = {},
): boolean {
  if (!card) return false;
  if (filters.requireFaceup === true && card.isFacedown) return false;
  if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) return false;
  if (filters.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(filters.archetype)) return false;
  }
  if (filters.type && card.type !== filters.type) return false;
  if (filters.attribute && card.attribute !== filters.attribute) return false;
  if (filters.name && card.name !== filters.name) return false;
  if (filters.subtype && card.subtype !== filters.subtype) return false;
  return true;
}

function getSelectionMessageForSource(
  source: ActionRuntimeCard | null | undefined,
): string {
  if (!source) return "Select target(s).";
  if (source.cardKind === "monster") {
    return "Select target(s) for the monster effect.";
  }
  if (source.cardKind === "spell") {
    if (source.subtype === "continuous") {
      return "Select target(s) for the continuous spell effect.";
    }
    if (source.subtype === "field") {
      return "Select target(s) for the field spell effect.";
    }
    return "Select target(s) for the spell effect.";
  }
  return "Select target(s) for the spell/trap effect.";
}

function buildZoneSelectionCandidates(
  player: ActionRuntimePlayer,
  game: ActionRuntimeGamePort,
  cards: readonly ActionRuntimeCard[],
  zoneName: string,
): ZoneSelectionCandidate[] {
  const zoneValue = Reflect.get(player, zoneName);
  const zone = Array.isArray(zoneValue) ? zoneValue : [];
  const controller = player?.id || "player";

  return cards.map((card, idx) => {
    const candidate: ZoneSelectionCandidate = {
      idx,
      key: "",
      name: card?.name || "Card",
      owner: "player",
      controller,
      zone: zoneName,
      zoneIndex: zone.indexOf(card),
      position: card?.position || "",
      atk: card?.atk,
      def: card?.def,
      level: card?.level,
      cardKind: card?.cardKind,
      cardRef: card,
    };

    candidate.key =
      typeof game?.buildSelectionCandidateKey === "function"
        ? game.buildSelectionCandidateKey(candidate, idx)
        : `${controller}:${zoneName}:${candidate.zoneIndex}:${
            card?.id || card?.name || idx
          }`;

    return candidate;
  });
}

function buildAddToHandSelectionContract(
  action: SearchAction,
  ctx: EffectContext,
  { player, game, sourceZone }: AddToHandContractContext,
): (
  cards: readonly ActionRuntimeCard[],
  range: SelectionRange,
) => SelectionContractData {
  return (cards: readonly ActionRuntimeCard[], range: SelectionRange) => {
    const requirementId =
      readString(action, "selectionId") ||
      `${ctx?.effect?.id || action.type || "add_from_zone_to_hand"}_selection`;
    const decorated = buildZoneSelectionCandidates(
      player,
      game,
      cards,
      sourceZone,
    );

    return {
      kind: "target",
      requirementId,
      decorated,
      selectionContract: {
        kind: "target",
        message:
          readString(action, "selectionMessage") ||
          getSelectionMessageForSource(ctx?.source || null),
        requirements: [
          {
            id: requirementId,
            label: readString(action, "selectionLabel") || requirementId,
            min: range.min,
            max: range.max,
            zones: [sourceZone],
            owner: "player",
            filters: action.filters || {},
            allowSelf: true,
            distinct: true,
            candidates: decorated,
          },
        ],
        ui: {
          useFieldTargeting: false,
          allowEmpty: Number(range.min || 0) === 0,
        },
        metadata: {
          context: "add_from_zone_to_hand",
          sourceCard: ctx?.source || null,
          sourceCardName: ctx?.source?.name || null,
          effectId: ctx?.effect?.id || null,
          sourceZone,
        },
      },
    };
  };
}

function normalizeSelectionCount(
  count: number | SelectionCount | null | undefined,
  fallback = 1,
): SelectionRange {
  if (typeof count === "number" && Number.isFinite(count)) {
    return { min: count, max: count };
  }
  const structuredCount = typeof count === "object" ? count : null;
  const min =
    typeof structuredCount?.min === "number" &&
    Number.isFinite(structuredCount.min)
      ? structuredCount.min
      : fallback;
  const max =
    typeof structuredCount?.max === "number" &&
    Number.isFinite(structuredCount.max)
      ? structuredCount.max
      : min;
  return {
    min: Math.max(0, min),
    max: Math.max(0, max),
  };
}

function resolveActionPlayer(
  action: { readonly player?: string },
  ctx: EffectContext,
): ActionRuntimePlayer | null | undefined {
  return action?.player === "opponent" ? ctx?.opponent : ctx?.player;
}

function buildDiscardSelectionContract(
  action: DiscardAction,
  ctx: EffectContext,
  { affectedPlayer, game }: DiscardContractContext,
): (
  cards: readonly ActionRuntimeCard[],
  range: SelectionRange,
) => SelectionContractData {
  return (cards: readonly ActionRuntimeCard[], range: SelectionRange) => {
    const requirementId =
      action.selectionId ||
      `${ctx?.effect?.id || action.type || "discard_from_hand"}_selection`;
    const decorated = buildZoneSelectionCandidates(
      affectedPlayer,
      game,
      cards,
      "hand",
    );

    return {
      kind: "target",
      requirementId,
      decorated,
      selectionContract: {
        kind: "target",
        message:
          action.selectionMessage ||
          getUIText("ui.selection.chooseTargetCount", {
            count: range.max,
            label: action.selectionLabel || "discard",
          }),
        requirements: [
          {
            id: requirementId,
            label: action.selectionLabel || "Discard",
            min: range.min,
            max: range.max,
            zones: ["hand"],
            owner: "player",
            filters: action.filters || {},
            allowSelf: true,
            distinct: true,
            candidates: decorated,
          },
        ],
        ui: {
          useFieldTargeting: false,
          allowEmpty: Number(range.min || 0) === 0,
        },
        metadata: {
          context: "discard_from_hand",
          intent: action.contextLabel === "cost" ? "cost" : "discard",
          sourceCard: ctx?.source || null,
          sourceCardName: ctx?.source?.name || null,
          effectId: ctx?.effect?.id || null,
          sourceZone: "hand",
        },
      },
    };
  };
}

function rankDiscardCandidates(
  cards: readonly ActionRuntimeCard[],
  max: number,
): ActionRuntimeCard[] {
  return cards
    .slice()
    .sort((a, b) => {
      const aValue =
        a?.cardKind === "monster"
          ? Number(a.atk || 0) + Number(a.def || 0)
          : 900;
      const bValue =
        b?.cardKind === "monster"
          ? Number(b.atk || 0) + Number(b.def || 0)
          : 900;
      return aValue - bValue;
    })
    .slice(0, max);
}

/**
 * Generic handler for paying Life Points as a cost
 *
 * Action properties:
 * - amount: LP to pay
 * - fraction: alternative, pay a fraction of current LP (0.5 = half)
 */
export async function handlePayLP(
  action: ActionOf<"pay_lp">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;

  const game = engine.game;

  if (!player || !game) {
    console.log("[handlePayLP] Missing player or game");
    return false;
  }

  let amount = action.amount || 0;

  if (action.fraction) {
    amount = Math.floor(player.lp * action.fraction);
  }

  if (amount <= 0) {
    console.log("[handlePayLP] Amount is zero or negative:", amount);
    return false;
  }

  const baseAmount = amount;
  if (engine && typeof engine.resolveLpCost === "function") {
    const costResult = engine.resolveLpCost(action, ctx, amount);
    if (costResult && typeof costResult.finalAmount === "number") {
      amount = costResult.finalAmount;
    }
    if (costResult?.reduction > 0) {
      console.log(
        `[handlePayLP] Cost reduced: ${baseAmount} -> ${amount} (reduced ${costResult.reduction})`
      );
    }
  }

  if (amount <= 0) {
    getUI(game)?.log("LP cost reduced to 0.");
    return true;
  }

  if (player.lp < amount) {
    console.log(`[handlePayLP] Not enough LP: ${player.lp} < ${amount}`);
    getUI(game)?.log("Not enough LP to pay cost.");
    return false;
  }

  const before = player.lp;
  player.lp -= amount;
  console.log(
    `[handlePayLP] SUCCESS: Paid ${amount} LP, remaining ${player.lp}`
  );
  game.notify?.("lp_change", {
    player,
    sourceCard: ctx.source,
    lpPaid: amount,
    before,
    after: player.lp,
  });

  getUI(game)?.log(`${player.name || player.id} paid ${amount} LP.`);

  game.updateBoard();

  return true;
}

function normalizeCardNameList(values: unknown = []): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const entries = Array.isArray(values) ? values : [values];
  for (const entry of entries) {
    const name =
      typeof entry === "string"
        ? entry.trim()
        : isRecord(entry) && typeof entry.name === "string"
          ? entry.name.trim()
          : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function readNameSource(
  action: ActionOf<"restrict_effect_activations_by_names">,
  ctx: EffectContext,
): unknown {
  const sourceKey = action.nameSource || readString(action, "namesSource") || null;
  if (!sourceKey) return [];
  if (sourceKey === "lastDrawnCards") return ctx?.lastDrawnCards || [];
  if (sourceKey === "lastDrawnCard") return ctx?.lastDrawnCard || null;
  if (sourceKey === "lastAddedToHandCards") {
    return ctx?.lastAddedToHandCards || [];
  }
  if (sourceKey === "lastAddedToHandCard") return ctx?.lastAddedToHandCard || null;
  return (
    readContextValue(ctx, sourceKey) ||
    (ctx.activationContext ? Reflect.get(ctx.activationContext, sourceKey) : undefined) ||
    (ctx.actionContext ? Reflect.get(ctx.actionContext, sourceKey) : undefined) ||
    []
  );
}

function normalizeAttributeList(values: unknown = []): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const entries = Array.isArray(values) ? values : [values];
  for (const entry of entries) {
    const attribute =
      typeof entry === "string"
        ? entry.trim()
        : isRecord(entry) && typeof entry.attribute === "string"
          ? entry.attribute.trim()
          : "";
    if (!attribute) continue;
    const key = attribute.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(attribute);
  }
  return result;
}

function flattenCards(value: unknown): ActionRuntimeCard[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenCards);
  return isRuntimeCard(value) ? [value] : [];
}

function readAttributeSourceCards(
  action: ActionOf<"restrict_effect_activations_by_attribute">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
): ActionRuntimeCard[] {
  const sourceRef =
    action.attributeSourceRef ||
    action.attributeSource ||
    action.sourceRef ||
    action.targetRef ||
    null;
  if (!sourceRef) return [];

  const targetCards = getCardsFromTargetRefs(sourceRef, targets);
  if (targetCards.length > 0) return targetCards;

  const actionTargets = ctx?._actionTargets || {};
  if (actionTargets[sourceRef]) return flattenCards(actionTargets[sourceRef]);

  const actionResults = ctx.actionContext
    ? Reflect.get(ctx.actionContext, "actionResults")
    : undefined;
  const contextCandidates: unknown[] = [
    readContextValue(ctx, sourceRef),
    ctx.activationContext
      ? Reflect.get(ctx.activationContext, sourceRef)
      : undefined,
    ctx.actionContext ? Reflect.get(ctx.actionContext, sourceRef) : undefined,
    isRecord(actionResults) ? Reflect.get(actionResults, sourceRef) : undefined,
  ];
  return contextCandidates.flatMap(flattenCards);
}

export async function handleRestrictEffectActivationsByNames(
  action: ActionOf<"restrict_effect_activations_by_names">,
  ctx: EffectContext,
  _targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  const targetPlayer = action.player === "opponent" ? ctx?.opponent : ctx?.player;
  if (!game || !targetPlayer) return false;

  const explicitNames =
    action.names || action.cardNames || action.blockedNames || [];
  const sourceNames = readNameSource(action, ctx);
  const blockedNames = normalizeCardNameList([
    ...normalizeCardNameList(explicitNames),
    ...normalizeCardNameList(sourceNames),
  ]);
  if (blockedNames.length === 0) return false;

  const success = game.registerEffectActivationRestriction?.(targetPlayer, {
    blockedNames,
    duration: action.duration || "until_end_turn",
    reason: action.reason || null,
    sourceCard: ctx?.source || ctx?.card || null,
    effectId: ctx?.effect?.id || null,
  });

  if (success && action.logMessage) {
    getUI(game)?.log(action.logMessage);
  }
  return success === true;
}

export async function handleRestrictEffectActivationsByAttribute(
  action: ActionOf<"restrict_effect_activations_by_attribute">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  const targetPlayer = action.player === "opponent" ? ctx?.opponent : ctx?.player;
  if (!game || !targetPlayer) return false;

  const sourceCards = readAttributeSourceCards(action, ctx, targets);
  const allowedAttributes = normalizeAttributeList([
    ...normalizeAttributeList(action.allowedAttributes || action.attributes || []),
    ...normalizeAttributeList(sourceCards),
  ]);
  if (allowedAttributes.length === 0) return false;

  const success = game.registerEffectActivationRestriction?.(targetPlayer, {
    allowedAttributes,
    restrictedCardFilters: action.restrictedCardFilters || { cardKind: "monster" },
    duration: action.duration || "until_end_turn",
    reason: action.reason || null,
    sourceCard: ctx?.source || ctx?.card || null,
    effectId: ctx?.effect?.id || null,
  });

  if (success && action.logMessage) {
    getUI(game)?.log(action.logMessage);
  }
  return success === true;
}

/**
 * Generic handler for adding cards from any zone to hand
 * Supports multi-select with filters
 *
 * Action properties:
 * - zone: source zone (default: "graveyard")
 * - filters: { archetype, name, level, cardKind, excludeSelf }
 * - count: { min, max } for selection count
 * - promptPlayer: boolean (default: true for human player)
 */
function resolveMarkerExpirationTurn(
  game: ActionRuntimeGamePort,
  markerConfig: MarkerConfig = {},
): number {
  const currentTurn = Number(game?.turnCounter || 0);
  if (
    typeof markerConfig.expiresOnTurn === "number" &&
    Number.isFinite(markerConfig.expiresOnTurn)
  ) {
    return markerConfig.expiresOnTurn;
  }
  if (
    typeof markerConfig.durationTurns === "number" &&
    Number.isFinite(markerConfig.durationTurns)
  ) {
    return currentTurn + Math.max(0, markerConfig.durationTurns);
  }
  if (markerConfig.duration === "end_of_next_turn") {
    return currentTurn + 1;
  }
  return currentTurn;
}

function markAddedCards(
  selectedCards: readonly ActionRuntimeCard[],
  action: SearchAction,
  ctx: EffectContext,
  game: ActionRuntimeGamePort,
  player: ActionRuntimePlayer,
): void {
  const markerConfig = readMarkerConfig(action);
  if (!markerConfig || typeof markerConfig !== "object" || !markerConfig.key) {
    return;
  }

  const source = ctx?.source || null;
  const marker = {
    key: markerConfig.key,
    sourceInstanceId:
      markerConfig.bindToSource === false ? null : getCardInstanceId(source),
    sourceCardId:
      markerConfig.bindToSource === false ? null : source?.id ?? null,
    sourceEffectId:
      markerConfig.sourceEffectId ||
      ctx?.effect?.id ||
      readString(action, "sourceEffectId") ||
      null,
    controllerId: player?.id || null,
    markedOnTurn: Number(game?.turnCounter || 0),
    expiresOnTurn: resolveMarkerExpirationTurn(game, markerConfig),
  };

  for (const card of selectedCards || []) {
    if (!card) continue;
    const currentMarkers = Reflect.get(card, "effectMarkers");
    const effectMarkers = isRecord(currentMarkers) ? currentMarkers : {};
    if (!isRecord(currentMarkers)) {
      Reflect.set(card, "effectMarkers", effectMarkers);
    }
    Reflect.set(effectMarkers, markerConfig.key, { ...marker });
  }
}

export async function handleAddFromZoneToHand(
  action: ActionOf<"add_from_zone_to_hand" | "search_any">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, source } = ctx;
  const game = engine.game;
  // Online sempre deve pedir seleção para o seat humano, mesmo se o id legado for "bot".
  // Auto-seleção só deve ocorrer quando o controllerType é IA.
  const promptPlayer = action.promptPlayer !== false && !isAI(player);

  if (!player || !game) return false;

  const inferredSearch =
    action?.type === "search_any" || readString(action, "mode") === "search_any";
  const sourceZone: ZoneInput =
    action.zone || (inferredSearch ? "deck" : "graveyard");
  const zone = getPlayerZoneCards(player, sourceZone);
  const count = action.count || { min: 1, max: 1 };
  const minSelect = Math.max(count.min || 0, 0);

  if (!zone || zone.length === 0) {
    if (minSelect === 0) {
      getUI(game)?.log("No cards selected (optional).");
      game.updateBoard();
      return true;
    }
    getUI(game)?.log(`No cards in ${sourceZone}.`);
    return false;
  }

  // Apply filters
  const baseFilters = action.filters || {};
  const filters: MutableRuntimeSearchFilter = { ...baseFilters };
  const addExcludedNames = (names: unknown): void => {
    const list = Array.isArray(names) ? names : [names];
    const existing = Array.isArray(filters.excludeCardNames)
      ? filters.excludeCardNames
      : filters.excludeCardName
        ? [filters.excludeCardName]
        : [];
    const next = new Set(existing.filter(Boolean));
    for (const name of list) {
      if (typeof name === "string" && name) {
        next.add(name);
      }
    }
    if (next.size > 0) {
      filters.excludeCardNames = Array.from(next);
    }
  };

  addExcludedNames(Reflect.get(action, "excludeName"));
  addExcludedNames(Reflect.get(action, "excludeCardName"));
  addExcludedNames(Reflect.get(action, "excludeCardNames"));
  const excludeNameRef = readString(action, "excludeNameRef");
  if (excludeNameRef && targets?.[excludeNameRef]) {
    const refCards = getCardsFromTargetRefs(excludeNameRef, targets);
    addExcludedNames(refCards.map((card) => card?.name).filter(Boolean));
  }
  const excludeTargetRef = readString(action, "excludeTargetRef");
  const excludeTargetRefs = readStringArray(action, "excludeTargetRefs");
  const excludedTargetCards = getCardsFromTargetRefs(
    [
      excludeTargetRef,
      ...excludeTargetRefs,
    ],
    targets,
  );
  if (excludedTargetCards.length > 0) {
    const excludedInstanceIds = excludedTargetCards
      .map(getCardInstanceId)
      .filter((value) => value !== undefined && value !== null);
    filters.excludeCards = [
      ...(Array.isArray(filters.excludeCards) ? filters.excludeCards : []),
      ...excludedTargetCards,
    ];
    if (excludedInstanceIds.length > 0) {
      filters.excludeInstanceIds = [
        ...(Array.isArray(filters.excludeInstanceIds)
          ? filters.excludeInstanceIds
          : filters.excludeInstanceId !== undefined &&
              filters.excludeInstanceId !== null
            ? [filters.excludeInstanceId]
            : []),
        ...excludedInstanceIds,
      ];
    }
  }

  if (inferredSearch) {
    if (action.archetype && !filters.archetype) {
      filters.archetype = action.archetype;
    }
    if (action.cardKind && !filters.cardKind) {
      filters.cardKind = action.cardKind;
    }
    if (action.cardName && !filters.name) {
      filters.name = action.cardName;
    }
  }

  const extraFilter = (card: ActionRuntimeCard): boolean => {
    if (!card) return false;
    if (Array.isArray(filters.cardKind)) {
      if (!cardMatchesKind(card, filters.cardKind)) return false;
    }
    if (Array.isArray(filters.name)) {
      if (!filters.name.includes(card.name)) return false;
    }
    if (action.cardName) {
      const match = action.cardName.toLowerCase();
      if ((card.name || "").toLowerCase() !== match) return false;
    }
    const cardId = readNumber(action, "cardId");
    if (typeof cardId === "number" && card.id !== cardId) {
      return false;
    }
    if (
      typeof action.minLevel === "number" &&
      (card.level || 0) < action.minLevel
    ) {
      return false;
    }
    if (
      typeof action.maxLevel === "number" &&
      (card.level || 0) > action.maxLevel
    ) {
      return false;
    }
    return true;
  };

  const candidates = collectZoneCandidates(zone, filters, {
    source,
    engine,
    extraFilter,
  });

  if (candidates.length === 0) {
    if (minSelect === 0) {
      getUI(game)?.log("No cards selected (optional).");
      game.updateBoard();
      return true;
    }
    getUI(game)?.log(`No valid cards in ${sourceZone} matching filters.`);
    return false;
  }

  const maxSelect = Math.min(count.max!, candidates.length);
  const canUseTargetSelection =
    promptPlayer !== false &&
    typeof game.startTargetSelectionSession === "function";

  if (maxSelect === 0) {
    getUI(game)?.log("No cards available to add.");
    return false;
  }

  const finalizeSelection = async (
    selectedCards: readonly ActionRuntimeCard[],
  ): Promise<boolean> => {
    const selected = Array.isArray(selectedCards) ? selectedCards : [];
    if (selected.length === 0) {
      if (minSelect === 0) {
        getUI(game)?.log("No cards selected (optional).");
        game.updateBoard();
        return true;
      }
      getUI(game)?.log("No cards selected.");
      return false;
    }

    const movedCards: ActionRuntimeCard[] = [];
    for (const card of selected) {
      if (typeof game.moveCard === "function") {
        const moveResult = await game.moveCard(card, player, "hand", {
          fromZone: sourceZone,
          sourceCard: source,
          effectId: ctx.effect?.id || null,
          awaitEvents: true,
        });
        if (!isMoveSuccess(moveResult)) {
          return false;
        }
        movedCards.push(card);
      } else {
        const idx = zone.indexOf(card);
        if (idx !== -1) {
          zone.splice(idx, 1);
          player.hand.push(card);
          movedCards.push(card);
        }
      }
    }

    ctx.lastAddedToHandCards = movedCards;
    ctx.lastAddedToHandCard = movedCards[0] || null;
    storeActionResultCards(action, ctx, targets, movedCards);
    markAddedCards(movedCards, action, ctx, game, player);

    const addedText =
      player.id === "bot"
        ? `${player.name || player.id} added ${
            movedCards.length
          } card(s) to hand from ${sourceZone}.`
        : movedCards.length === 1
        ? `Added ${movedCards[0].name} to hand from ${sourceZone}.`
        : `Added ${movedCards.length} card(s) to hand from ${sourceZone}.`;
    getUI(game)?.log(addedText);

    // v3: Emit event for replay capture - track which cards were added to hand
    if (typeof game.emit === "function") {
      await game.emit("cards_added_to_hand", {
        player,
        cards: movedCards,
        fromZone: sourceZone,
        sourceCard: source,
        effectId: ctx.effect?.id || null,
      });
    }

    game.updateBoard();
    return true;
  };

  const selection = await selectCardsFromZone({
    game,
    player,
    zone,
    source,
    filters,
    candidates,
    maxSelect,
    minSelect,
    promptPlayer: promptPlayer !== false,
    botSelect: (cards, max) => {
      if (typeof player.strategy?.rankSearchCandidates === "function") {
        const ranked = player.strategy.rankSearchCandidates(cards, action, {
          player,
          source,
          game,
          ctx,
        });
        if (Array.isArray(ranked)) {
          return ranked.slice(0, max);
        }
      }

      // Apply botPrefer rules: if hand contains a trigger card, prefer a specific search target
      const botPreferences = readBotPreferenceRules(action);
      if (botPreferences.length > 0) {
        const hand = player.hand || [];
        for (const rule of botPreferences) {
          const triggerInHand =
            !rule.ifHandHas ||
            hand.some((c) => c.name === rule.ifHandHas);
          if (triggerInHand) {
            const preferred = cards.find((c) => c.name === rule.prefer);
            if (preferred) {
              const rest = cards.filter((c) => c !== preferred);
              return [preferred, ...rest].slice(0, max);
            }
          }
        }
      }
      return cards[0]?.cardKind === "monster"
        ? cards
            .slice()
            .sort((a, b) => (b.atk || 0) - (a.atk || 0))
            .slice(0, max)
        : cards.slice(0, max);
    },
    selectSingle: (cards) => {
      const renderer = getUI(game);
      const searchModal = renderer?.getSearchModalElements?.();
      const defaultCardName = cards[0]?.name || "";

      if (!searchModal) {
        return cards[0];
      }

      return new Promise((resolve) => {
        game.isResolvingEffect = true;
        if (!renderer.showSearchModalVisual) {
          resolve(cards[0]);
          return;
        }
        renderer.showSearchModalVisual(
          searchModal,
          [...cards],
          defaultCardName,
          (selectedName: string) => {
            const chosen =
              cards.find((c) => c && c.name === selectedName) || cards[0];
            game.isResolvingEffect = false;
            resolve(chosen);
          }
        );
      });
    },
    selectionContractBuilder: canUseTargetSelection
      ? buildAddToHandSelectionContract(action, ctx, {
          player,
          game,
          sourceZone,
        })
      : undefined,
    selectMulti: (cards, range) => {
      const ui = getUI(game);
      if (!ui.showMultiSelectModal) {
        return cards.slice(0, range.max);
      }
      return new Promise((resolve) => {
        ui.showMultiSelectModal!(
          [...cards],
          { min: range.min, max: range.max },
          (selected: unknown) => {
            resolve(Array.isArray(selected) ? selected.filter(isRuntimeCard) : []);
          }
        );
      });
    },
  });

  const result = await finalizeSelection(selection.selected || []);
  return result;
}

export async function handleDiscardFromHand(
  action: ActionOf<"discard_from_hand">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  const affectedPlayer = resolveActionPlayer(action, ctx);
  const source = ctx?.source || null;

  if (!game || !affectedPlayer) return false;

  const hand = affectedPlayer.hand || [];
  const count = normalizeSelectionCount(action.count, 1);
  const minSelect = count.min;
  const candidates = collectZoneCandidates(hand, action.filters || {}, {
    source,
    engine,
  });

  if (candidates.length < minSelect) {
    getUI(game)?.log(
      `${affectedPlayer.name || affectedPlayer.id} does not have enough cards to discard.`,
    );
    return false;
  }

  const maxSelect = Math.min(count.max, candidates.length);
  if (maxSelect <= 0) {
    return minSelect === 0;
  }

  const canUseTargetSelection =
    typeof game.startTargetSelectionSession === "function";
  const selectionContractBuilder = canUseTargetSelection
    ? buildDiscardSelectionContract(action, ctx, {
        affectedPlayer,
        game,
      })
    : undefined;

  let selected: ActionRuntimeCard[] = [];
  if (isAI(affectedPlayer) && typeof selectionContractBuilder === "function") {
    const selectionData = selectionContractBuilder(candidates, {
      min: minSelect,
      max: maxSelect,
    });
    const autoResult = game.autoSelector?.select?.(
      selectionData.selectionContract,
      {
        owner: affectedPlayer,
        player: affectedPlayer,
        source,
        selectionContract: selectionData.selectionContract,
        game,
        activationContext: ctx?.activationContext || {},
      },
    );
    const normalizedAutoResult = isAutoSelectionResult(autoResult)
      ? autoResult
      : null;
    const selectedKeys =
      normalizedAutoResult?.ok && normalizedAutoResult.selections
        ? normalizedAutoResult.selections[selectionData.requirementId] || []
        : [];
    const decorated = selectionData.decorated || [];
    selected = selectedKeys
      .map((key) => decorated.find((candidate) => candidate.key === key)?.cardRef)
      .filter(isRuntimeCard);
    if (selected.length < minSelect) {
      selected = rankDiscardCandidates(candidates, maxSelect);
    }
  } else {
    const selection = await selectCardsFromZone({
      game,
      player: affectedPlayer,
      zone: hand,
      source,
      filters: action.filters || {},
      candidates,
      maxSelect,
      minSelect,
      promptPlayer: action.promptPlayer !== false,
      botSelect: (cards, max) => rankDiscardCandidates(cards, max),
      selectSingle: (cards) => cards[0],
      selectMulti: (cards, range) => cards.slice(0, range.max),
      selectionContractBuilder,
    });

    selected = Array.isArray(selection.selected)
      ? selection.selected.filter(isRuntimeCard)
      : [];
  }

  if (selected.length < minSelect) {
    getUI(game)?.log("Discard cancelled.");
    return false;
  }

  for (const card of selected) {
    const moveResult = await game.moveCard(card, affectedPlayer, "graveyard", {
      fromZone: "hand",
      sourceCard: source,
      effectId: ctx?.effect?.id || null,
      contextLabel: action.contextLabel || "discard",
      movedByEffect: true,
      awaitEvents: true,
    });
    if (!isMoveSuccess(moveResult)) {
      return false;
    }
  }

  if (selected.length === 1) {
    getUI(game)?.log(
      `${affectedPlayer.name || affectedPlayer.id} discarded ${getCardDisplayName(selected[0])}.`,
    );
  } else {
    getUI(game)?.log(
      `${affectedPlayer.name || affectedPlayer.id} discarded ${selected.length} cards.`,
    );
  }
  game.updateBoard();

  return true;
}

/**
 * Search a card, add it to hand, then optionally Special Summon that same card.
 *
 * Action properties:
 * - zone: source zone (default: "deck")
 * - filters: card filters for the search
 * - count: currently resolves the first selected card, default { min: 1, max: 1 }
 * - summonCondition: { type: "empty_field" } or omitted
 * - optional: whether the Special Summon can be declined (default: true)
 * - position: "attack" | "defense" | "choice"
 */
export async function handleSearchThenOptionalSpecialSummonFromHand(
  action: ActionOf<"search_then_optional_special_summon_from_hand">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, source } = ctx;
  const game = engine.game;
  const promptPlayer = action.promptPlayer !== false && !isAI(player);

  if (!player || !game) return false;

  const sourceZone = action.zone || "deck";
  const zoneValue = Reflect.get(player, sourceZone);
  const zone = Array.isArray(zoneValue) ? zoneValue : [];

  if (!Array.isArray(zone) || zone.length === 0) {
    getUI(game)?.log(`No cards in ${sourceZone}.`);
    return false;
  }

  const filters = buildSearchFilters(action);
  const candidates = collectZoneCandidates(zone, filters, {
    source,
    engine,
    extraFilter: (card) => cardMatchesSearchAction(card, action),
  });

  if (candidates.length === 0) {
    getUI(game)?.log(`No valid cards in ${sourceZone} matching filters.`);
    return false;
  }

  const count = action.count || { min: 1, max: 1 };
  const requestedMax = Number.isFinite(count.max) ? count.max! : 1;
  const maxSelect = Math.min(requestedMax, 1, candidates.length);
  const minSelect = Math.max(count.min ?? 1, 0);

  if (maxSelect <= 0 || minSelect > maxSelect) {
    getUI(game)?.log("No cards available to add.");
    return false;
  }

  const selection = await selectCardsFromZone({
    game,
    player,
    zone,
    source,
    filters,
    candidates,
    maxSelect,
    minSelect,
    promptPlayer,
    botSelect: (cards, max) => {
      if (typeof player.strategy?.rankSearchCandidates === "function") {
        const ranked = player.strategy.rankSearchCandidates(cards, action, {
          player,
          source,
          game,
          ctx,
        });
        if (Array.isArray(ranked)) {
          return ranked.slice(0, max);
        }
      }

      return cards
        .slice()
        .sort((a, b) => (b.atk || 0) - (a.atk || 0))
        .slice(0, max);
    },
    selectSingle: (cards) => selectSingleSearchCard(game, cards),
    selectMulti: (cards, range) => cards.slice(0, range.max),
  });

  const searchedCard = selection.selected?.[0] || null;
  if (!searchedCard) {
    getUI(game)?.log("No cards selected.");
    return false;
  }

  const moveResult =
    typeof game.moveCard === "function"
      ? await game.moveCard(searchedCard, player, "hand", {
          fromZone: sourceZone,
          sourceCard: source,
          effectId: ctx.effect?.id || null,
          awaitEvents: true,
        })
      : null;

  if (isRecord(moveResult) && moveResult.success === false) {
    return false;
  }

  if (moveResult == null) {
    const index = zone.indexOf(searchedCard);
    if (index !== -1) zone.splice(index, 1);
    player.hand = player.hand || [];
    player.hand.push(searchedCard);
  }

  getUI(game)?.log(
    `${player.name || player.id} added ${searchedCard.name} to hand from ${sourceZone}.`,
  );

  if (typeof game.emit === "function") {
    await game.emit("cards_added_to_hand", {
      player,
      cards: [searchedCard],
      fromZone: sourceZone,
      sourceCard: source,
      effectId: ctx.effect?.id || null,
    });
  }

  game.updateBoard();

  if (!canResolveFollowupSummon(action, player)) {
    return true;
  }

  if (!player.hand?.includes(searchedCard)) {
    getUI(game)?.log(`${searchedCard.name} is no longer in hand.`);
    return true;
  }

  if ((player.field || []).length >= 5) {
    getUI(game)?.log("No Monster Zone available for Special Summon.");
    return true;
  }

  const shouldSummon = await shouldPerformOptionalSummon(
    action,
    game,
    player,
    searchedCard,
  );

  if (!shouldSummon) {
    return true;
  }

  const summonResult = await summonFromHandCore({
    card: searchedCard,
    player,
    engine,
    game,
    position: action.position,
    cannotAttackThisTurn:
      action.restrictAttackThisTurn || action.cannotAttackThisTurn || false,
  });

  if (!summonResult.success) {
    return true;
  }

  getUI(game)?.log(
    `${player.name || player.id} Special Summoned ${searchedCard.name} from hand.`,
  );
  game.updateBoard();

  if (game.finishSelection && typeof game.finishSelection === "function") {
    game.finishSelection();
  }

  return true;
}

function buildSearchFilters(action: FollowupSearchAction): MutableRuntimeSearchFilter {
  const filters: MutableRuntimeSearchFilter = { ...(action.filters || {}) };
  if (action.archetype && !filters.archetype) filters.archetype = action.archetype;
  if (action.cardKind && !filters.cardKind) filters.cardKind = action.cardKind;
  if (action.cardName && !filters.name) filters.name = action.cardName;
  if (Number.isFinite(action.minAtk) && filters.minAtk == null) {
    filters.minAtk = action.minAtk;
  }
  if (Number.isFinite(action.maxAtk) && filters.maxAtk == null) {
    filters.maxAtk = action.maxAtk;
  }
  if (Number.isFinite(action.minLevel) && filters.minLevel == null) {
    filters.minLevel = action.minLevel;
  }
  if (Number.isFinite(action.maxLevel) && filters.maxLevel == null) {
    filters.maxLevel = action.maxLevel;
  }
  return filters;
}

function cardMatchesSearchAction(
  card: ActionRuntimeCard,
  action: FollowupSearchAction,
): boolean {
  if (!card) return false;
  if (action.cardName) {
    const match = action.cardName.toLowerCase();
    if ((card.name || "").toLowerCase() !== match) return false;
  }
  if (typeof action.cardId === "number" && card.id !== action.cardId) {
    return false;
  }
  return true;
}

function selectSingleSearchCard(
  game: ActionRuntimeGamePort,
  cards: readonly ActionRuntimeCard[],
): ActionRuntimeCard | undefined | Promise<ActionRuntimeCard | undefined> {
  const renderer = getUI(game);
  const searchModal = renderer?.getSearchModalElements?.();
  const defaultCardName = cards[0]?.name || "";

  if (!searchModal) {
    return cards[0];
  }

  return new Promise<ActionRuntimeCard | undefined>((resolve) => {
    game.isResolvingEffect = true;
    renderer.showSearchModalVisual!(
      searchModal,
      cards,
      defaultCardName,
      (selectedName: string) => {
        const chosen =
          cards.find((card) => card && card.name === selectedName) || cards[0];
        game.isResolvingEffect = false;
        resolve(chosen);
      },
    );
  });
}

function canResolveFollowupSummon(
  action: FollowupSearchAction,
  player: ActionRuntimePlayer,
): boolean {
  const condition = action.summonCondition || action.condition;
  const conditionType = isRecord(condition)
    ? Reflect.get(condition, "type")
    : undefined;
  if (!conditionType) return true;

  if (conditionType === "empty_field") {
    return (player.field || []).length === 0;
  }

  return false;
}

async function shouldPerformOptionalSummon(
  action: FollowupSearchAction,
  game: ActionRuntimeGamePort,
  player: ActionRuntimePlayer,
  card: ActionRuntimeCard,
): Promise<boolean> {
  if (action.optional === false || isAI(player)) {
    return true;
  }

  const ui = getUI(game);
  if (ui && typeof ui.showConfirmPrompt === "function") {
    const cardName = getCardDisplayName(card) || card.name;
    const result = ui.showConfirmPrompt(
      action.promptMessage ||
        getUIText("ui.optionalSummon.prompt", { cardName }),
      {
        kind: "optional_special_summon",
        cardName,
        playerId: player.id,
        confirmLabel:
          action.confirmLabel || getUIText("ui.optionalSummon.confirm"),
        cancelLabel:
          action.cancelLabel || getUIText("ui.optionalSummon.cancel"),
        title: action.promptTitle || getUIText("ui.optionalSummon.title"),
      },
    );
    return isPromiseLikeBoolean(result)
      ? !!(await result)
      : !!result;
  }

  return true;
}

/**
 * Generic handler for healing based on destroyed monster's ATK
 *
 * Action properties:
 * - fraction: fraction of ATK to heal (default: 1.0)
 * - multiplier: alternative name for fraction
 * - useBaseAtk: when true, use printed ATK with fallback to current ATK
 */
export async function handleHealFromDestroyedAtk(
  action: ActionOf<"heal_from_destroyed_atk">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, destroyed } = ctx;

  const game = engine.game;

  if (!player || !game || !destroyed) return false;

  const fraction = action.fraction ?? action.multiplier ?? 1.0;
  const baseValue =
    action.useBaseAtk === true && Number.isFinite(Number(destroyed.baseAtk))
      ? Number(destroyed.baseAtk)
      : Number.isFinite(Number(destroyed.atk))
        ? Number(destroyed.atk)
        : 0;

  const healAmount = Math.floor(baseValue * fraction);

  if (healAmount <= 0) return false;

  const before = player.lp || 0;
  player.gainLP(healAmount, {
    cause: readString(action, "cause") || "effect",
    sourceCard: ctx.source || null,
    sourceRect:
      Reflect.get(action, "sourceRect") ||
      ctx?.activationContext?.sourceRect ||
      null,
  });
  await emitLpGainEvent(game, player, ctx.source, before);

  getUI(game)?.log(
    `${player.name || player.id} gained ${healAmount} LP from ${
      destroyed.name
    }'s ATK.`
  );

  game.updateBoard();

  return true;
}

/**
 * Generic handler for damage based on the destroyed monster's ATK.
 *
 * Action properties:
 * - fraction: fraction of ATK to deal (default: 1.0)
 * - multiplier: alternative name for fraction
 * - player: "self" or "opponent" from the resolving effect's perspective
 * - useBaseAtk: when true, use printed ATK with fallback to current ATK
 */
export async function handleDamageFromDestroyedAtk(
  action: ActionOf<"damage_from_destroyed_atk">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, opponent, destroyed } = ctx;
  const game = engine.game;

  if (!player || !game || !destroyed) return false;

  const targetPlayer = action.player === "self" ? player : opponent;
  if (!targetPlayer) return false;

  const fraction = action.fraction ?? action.multiplier ?? 1.0;
  const baseValue =
    action.useBaseAtk === true && Number.isFinite(Number(destroyed.baseAtk))
      ? Number(destroyed.baseAtk)
      : Number.isFinite(Number(destroyed.atk))
        ? Number(destroyed.atk)
        : 0;
  const damageAmount = Math.floor(baseValue * fraction);

  if (damageAmount <= 0) return false;

  if (typeof game.inflictDamage === "function") {
    game.inflictDamage(targetPlayer, damageAmount, {
      cause: "effect",
      sourceCard: ctx.source || destroyed,
      targetCard: destroyed,
    });
  } else {
    targetPlayer.takeDamage(damageAmount, {
      cause: "effect",
    });
  }

  getUI(game)?.log(
    `${targetPlayer.name || targetPlayer.id} took ${damageAmount} damage from ${
      destroyed.name
    }'s ATK.`,
  );

  game.updateBoard();
  game.checkWinCondition?.();

  return true;
}

/**
 * Handler for healing LP based on the Level of the monster destroyed in battle
 *
 * Action properties:
 * - multiplier: how much to multiply the level (default: 100)
 * - player: who gains LP ("self" default)
 */
export async function handleHealFromDestroyedLevel(
  action: ActionOf<"heal_from_destroyed_level">,

  ctx: EffectContext,

  targets: ResolvedTargetMap,

  engine: ActionHandlerEnginePort,
) {
  const { player, destroyed } = ctx;

  const game = engine.game;

  if (!player || !game || !destroyed) return false;

  const multiplier = action.multiplier || 100;

  const level = destroyed.level || 0;

  const healAmount = Math.floor(level * multiplier);

  if (healAmount <= 0) {
    getUI(game)?.log(`${destroyed.name} has Level 0, no LP gained.`);

    return true; // Still valid execution, just 0 heal
  }

  const before = player.lp || 0;
  player.gainLP(healAmount, {
    cause: readString(action, "cause") || "effect",
    sourceCard: ctx.source || null,
    sourceRect:
      Reflect.get(action, "sourceRect") ||
      ctx?.activationContext?.sourceRect ||
      null,
  });
  await emitLpGainEvent(game, player, ctx.source, before);

  getUI(game)?.log(
    `${
      player.name || player.id
    } gained ${healAmount} LP from destroying a Level ${level} monster!`
  );

  game.updateBoard();

  return true;
}

/**
 * Handler for healing LP based on count of matching cards on field
 *
 * Action properties:
 * - amountPerCard: LP to heal per matching card (required)
 * - filters: { owner, zone, cardKind, archetype, type, etc. }
 * - player: who gains LP ("self" default)
 */
export async function handleHealPerFieldCount(
  action: ActionOf<"heal_per_field_count">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, opponent } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const amountPerCard = action.amountPerCard || 0;
  if (amountPerCard <= 0) return false;

  const filters = action.filters || {};
  const ownerFilter = filters.owner || "self";
  const zoneFilter = filters.zone || "field";

  // Determine which player's zone to check
  const targetPlayer = ownerFilter === "opponent" ? opponent : player;
  if (!targetPlayer) return false;

  const zone = Reflect.get(targetPlayer, zoneFilter);
  if (!Array.isArray(zone)) return false;

  // Count matching cards
  let count = 0;
  for (const card of zone) {
    if (!card) continue;
    if (filters.cardKind && !cardMatchesKind(card, filters.cardKind)) continue;
    if (filters.archetype && card.archetype !== filters.archetype) continue;
    if (filters.type && card.type !== filters.type) continue;
    if (filters.name && card.name !== filters.name) continue;
    if (filters.requireFaceup && card.isFacedown) continue;
    count++;
  }

  if (count === 0) {
    getUI(game)?.log("No matching cards found on field.");
    return true; // Valid execution, just 0 heal
  }

  const healAmount = count * amountPerCard;
  const before = player.lp || 0;
  player.gainLP(healAmount, {
    cause: readString(action, "cause") || "effect",
    sourceCard: ctx.source || null,
    sourceRect:
      Reflect.get(action, "sourceRect") ||
      ctx?.activationContext?.sourceRect ||
      null,
  });
  await emitLpGainEvent(game, player, ctx.source, before);

  getUI(game)?.log(
    `${
      player.name || player.id
    } gained ${healAmount} LP (${count} card(s) x ${amountPerCard} LP).`
  );

  game.updateBoard();
  return true;
}

/**
 * Handler for healing LP based on the number of counters on field cards.
 *
 * Action properties:
 * - counterType: counter key to count (default: "default")
 * - amountPerCounter: LP to heal per counted counter (required)
 * - owner: whose field cards are counted ("self", "opponent", "any")
 * - zones: field zones to count from (default: ["field"])
 * - filters: optional card filters
 * - player: who gains LP ("self" default)
 */
export async function handleHealPerFieldCounter(
  action: ActionOf<"heal_per_field_counter">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine.game;
  if (!game) return false;

  const targetPlayer = action.player === "opponent" ? ctx.opponent : ctx.player;
  if (!targetPlayer) return false;

  const counterType = action.counterType || "default";
  const amountPerCounter = Number(action.amountPerCounter || 0);
  if (amountPerCounter <= 0) return false;

  const zones = Array.isArray(action.zones)
    ? action.zones
    : [action.zone || "field"];
  const filters = action.filters || {};
  let counterCount = 0;

  for (const scopedPlayer of getScopedPlayers(ctx, action.owner || "self")) {
    for (const zone of zones) {
      for (const card of getFieldCounterZoneCards(scopedPlayer, zone)) {
        if (!cardMatchesFieldCounterFilters(card, filters)) continue;
        const count =
          typeof card.getCounter === "function"
            ? Number(card.getCounter(counterType) || 0)
            : 0;
        counterCount += Math.max(0, count);
      }
    }
  }

  if (counterCount <= 0) {
    getUI(game)?.log(
      getUIText("ui.counters.noneFound", {
        counterLabel: getCounterDisplayLabel(counterType, 2),
      }),
    );
    return true;
  }

  const healAmount = counterCount * amountPerCounter;
  const before = targetPlayer.lp || 0;
  targetPlayer.gainLP(healAmount, {
    cause: readString(action, "cause") || "effect",
    sourceCard: ctx.source || null,
    sourceRect:
      Reflect.get(action, "sourceRect") ||
      ctx?.activationContext?.sourceRect ||
      null,
  });
  await emitLpGainEvent(game, targetPlayer, ctx.source, before);

  getUI(game)?.log(
    getUIText("ui.counters.healByCount", {
      playerName: targetPlayer.name || targetPlayer.id,
      healAmount,
      counterCount,
      counterLabel: getCounterDisplayLabel(counterType, counterCount),
      amountPerCounter,
    }),
  );

  game.updateBoard();
  return true;
}

/**
 * Handler for healing LP based on opponent-controlled cards plus opponent hand.
 *
 * Action properties:
 * - amountPerCard: LP to heal per counted card (required)
 * - player: who gains LP ("self" default)
 */
export async function handleHealPerOpponentCardsAndHand(
  action: ActionOf<"heal_per_opponent_cards_and_hand">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, opponent } = ctx;
  const game = engine.game;

  if (!player || !opponent || !game) return false;

  const amountPerCard = action.amountPerCard || 0;
  if (amountPerCard <= 0) return false;

  const targetPlayer = action.player === "opponent" ? opponent : player;
  const countedCards = [
    ...(opponent.field || []),
    ...(opponent.spellTrap || []),
    ...(opponent.hand || []),
  ];
  if (opponent.fieldSpell) {
    countedCards.push(opponent.fieldSpell);
  }

  const count = countedCards.filter(Boolean).length;
  if (count === 0) {
    getUI(game)?.log("Opponent has no cards to count for LP gain.");
    return true;
  }

  const healAmount = count * amountPerCard;
  const before = targetPlayer.lp || 0;
  targetPlayer.gainLP(healAmount, {
    cause: readString(action, "cause") || "effect",
    sourceCard: ctx.source || null,
    sourceRect:
      Reflect.get(action, "sourceRect") ||
      ctx?.activationContext?.sourceRect ||
      null,
  });
  await emitLpGainEvent(game, targetPlayer, ctx.source, before);

  getUI(game)?.log(
    `${targetPlayer.name || targetPlayer.id} gained ${healAmount} LP (${count} opponent card(s) x ${amountPerCard} LP).`,
  );

  game.updateBoard();
  return true;
}

/**
 * Generic handler for granting additional normal summons
 *
 * Action properties:
 * - count: number of additional normal summons to grant (default: 1)
 * - filters/archetype/cardKind: optional restriction for the extra summon
 */
export async function handleGrantAdditionalNormalSummon(
  action: ActionOf<"grant_additional_normal_summon">,

  ctx: EffectContext,

  targets: ResolvedTargetMap,

  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;

  const game = engine.game;

  if (!player || !game) return false;

  const rawCount = Number(action.count ?? 1);
  const count = Number.isFinite(rawCount) ? Math.max(1, rawCount) : 1;
  const filters = { ...(action.filters || {}) };
  if (action.archetype && !filters.archetype) filters.archetype = action.archetype;
  if (action.cardKind && !filters.cardKind) filters.cardKind = action.cardKind;

  if (Object.keys(filters).length > 0) {
    player.additionalNormalSummonPermissions =
      player.additionalNormalSummonPermissions || [];
    player.additionalNormalSummonPermissions.push({
      count,
      filters,
      sourceCardName: ctx?.source?.name || null,
      effectId: ctx?.effect?.id || null,
    });
  } else {
    player.additionalNormalSummons! += count;
  }

  const summonText = count === 1 ? "Normal Summon" : "Normal Summons";

  const restrictionText =
    Object.keys(filters).length > 0 ? " matching the listed restriction" : "";
  getUI(game)?.log(
    `You can conduct ${count} additional ${summonText}${restrictionText} this turn.`
  );

  game.updateBoard();

  return true;
}

function findSourceZone(
  engine: ActionHandlerEnginePort,
  player: ActionRuntimePlayer,
  source: ActionRuntimeCard,
): ZoneInput | null {
  if (!player || !source) return null;
  if (engine && typeof engine.findCardZone === "function") {
    const zone = engine.findCardZone(player, source);
    if (zone) return zone;
  }

  for (const zone of ["spellTrap", "fieldSpell", "field", "hand"] as const) {
    const zoneValue = Reflect.get(player, zone);
    if (Array.isArray(zoneValue) && zoneValue.includes(source)) {
      return zone;
    }
    if (zoneValue === source) {
      return zone;
    }
  }

  return null;
}

async function moveUpkeepSourceToFailureZone(
  game: ActionRuntimeGamePort,
  player: ActionRuntimePlayer,
  source: ActionRuntimeCard,
  failureZone: ZoneInput,
  sourceZone: ZoneInput | null,
  options: UpkeepMoveOptions = {},
): Promise<boolean | NeedsSelectionResult> {
  if (!game || !player || !source || !sourceZone) return false;

  if (typeof game.moveCard === "function") {
    const moveResult = await game.moveCard(source, player, failureZone, {
      fromZone: sourceZone,
      awaitEvents: true,
      sourceCard: options.sourceCard || source,
      effectId: options.effectId || null,
      contextLabel: "upkeep_failure",
    });
    if (
      typeof moveResult === "object" &&
      moveResult !== null &&
      moveResult.needsSelection
    ) {
      return {
        ...moveResult,
        needsSelection: true,
        success: false,
      } satisfies NeedsSelectionResult;
    }
    return (
      moveResult !== false &&
      (typeof moveResult !== "object" ||
        moveResult === null ||
        moveResult.success !== false)
    );
  }

  const sourceZoneValue = Reflect.get(player, sourceZone);
  const zoneArr = Array.isArray(sourceZoneValue) ? sourceZoneValue : null;
  if (!zoneArr) return false;

  const idx = zoneArr.indexOf(source);
  if (idx === -1) return false;

  zoneArr.splice(idx, 1);
  const failureZoneValue = Reflect.get(player, failureZone);
  const failureZoneCards = Array.isArray(failureZoneValue)
    ? failureZoneValue
    : [];
  if (!Array.isArray(failureZoneValue)) {
    Reflect.set(player, failureZone, failureZoneCards);
  }
  failureZoneCards.push(source);
  return true;
}

function shouldAiPayUpkeep(
  action: UpkeepAction,
  player: ActionRuntimePlayer,
  source: ActionRuntimeCard,
  lpCost: number,
): boolean {
  if (Reflect.get(action, "aiPay") === false) return false;
  const aiMinLpAfterPay = readNumber(action, "aiMinLpAfterPay");
  if (typeof aiMinLpAfterPay === "number") {
    return player.lp - lpCost >= aiMinLpAfterPay;
  }
  const aiMaxLpFraction = readNumber(action, "aiMaxLpFraction");
  if (typeof aiMaxLpFraction === "number" && player.lp > 0) {
    return lpCost / player.lp <= aiMaxLpFraction;
  }
  if (Reflect.get(source, "upkeepValue") === "low" && player.lp - lpCost < 2000) {
    return false;
  }
  return true;
}

async function confirmHumanUpkeepPayment(
  action: UpkeepAction,
  game: ActionRuntimeGamePort,
  player: ActionRuntimePlayer,
  source: ActionRuntimeCard,
  lpCost: number,
): Promise<boolean> {
  if (Reflect.get(action, "promptPlayer") === false) return true;

  const ui = getUI(game);
  if (ui && typeof ui.showConfirmPrompt === "function") {
    const cardName =
      getCardDisplayName(source) ||
      source.name ||
      getUIText("ui.upkeep.thisCard");
    const message =
      readString(action, "promptMessage") ||
      getUIText("ui.upkeep.prompt", { amount: lpCost, cardName });
    const result = ui.showConfirmPrompt(message, {
      kind: "upkeep_cost",
      cardName,
      lpCost,
      playerId: player.id,
      confirmLabel:
        readString(action, "confirmLabel") ||
        getUIText("ui.upkeep.confirm", { amount: lpCost }),
      cancelLabel:
        readString(action, "cancelLabel") || getUIText("ui.upkeep.cancel"),
      title: readString(action, "promptTitle") || getUIText("ui.upkeep.title"),
    });
    return isPromiseLikeBoolean(result)
      ? !!(await result)
      : !!result;
  }

  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    const cardName =
      getCardDisplayName(source) ||
      source.name ||
      getUIText("ui.upkeep.thisCard");
    return window.confirm(
      readString(action, "promptMessage") ||
        getUIText("ui.upkeep.prompt", { amount: lpCost, cardName }),
    );
  }

  return true;
}

/**
 * Generic handler for upkeep cost: pay LP or send card to graveyard
 * Implements the "Shadow-Heart Shield" upkeep effect pattern
 *
 * Action properties:
 * - lpCost: amount of LP to pay (default: 800)
 * - failureZone: zone to send if LP insufficient or player chooses not to pay (default: "graveyard")
 */
export async function handleUpkeepPayOrSendToGrave(
  action: ActionOf<"upkeep_pay_or_send_to_grave">,

  ctx: EffectContext,

  targets: ResolvedTargetMap,

  engine: ActionHandlerEnginePort,
) {
  const { player, source } = ctx;

  const game = engine.game;

  if (!player || !source || !game) return false;

  const lpCost = action.lpCost || 800;

  const failureZone = action.failureZone || "graveyard";

  const sourceZone = findSourceZone(engine, player, source);
  const sendToFailureZone = async (reason: string) => {
    const moved = await moveUpkeepSourceToFailureZone(
      game,
      player,
      source,
      failureZone,
      sourceZone,
      {
        sourceCard: source,
        effectId: ctx?.effect?.id || null,
      },
    );
    if (typeof moved === "object" && moved.needsSelection) {
      return moved;
    }
    if (!moved) {
      getUI(game)?.log(
        `${source.name} could not be sent to ${failureZone} (${reason}).`
      );
      game.updateBoard();
      return false;
    }
    getUI(game)?.log(
      `${source.name} sent to ${failureZone} (${reason}).`
    );
    game.updateBoard();
    return moved;
  };

  if (!sourceZone) {
    getUI(game)?.log(`${source.name} is no longer on the field for upkeep.`);
    return true; // Effect resolved, just couldn't pay
  }

  if (player.lp < lpCost) {
    return await sendToFailureZone("insufficient LP for upkeep");
  }

  const shouldPay = isAI(player)
    ? shouldAiPayUpkeep(action, player, source, lpCost)
    : await confirmHumanUpkeepPayment(action, game, player, source, lpCost);

  if (!shouldPay) {
    return await sendToFailureZone("upkeep not paid");
  }

  player.lp -= lpCost;

  getUI(game)?.log(`Paid ${lpCost} LP to maintain ${source.name}.`);

  game.updateBoard();

  return true;
}
