import { copyPlanningActionPresence } from "./actionIdentity.js";
import { copyModeledPassiveContributions, hasUnmodeledTemporaryPassiveSuppression } from "../../effects/passives/passiveBuffs.js";
import type {
  AiCardInput,
  AiPlayerInput,
  AiStateInput,
  AiStateShape,
  SimulatedCardShape,
  SimulatedCardState,
} from "../../contracts/aiState.js";
import type { PublicProjectionGuardReport } from "../../contracts/ai.js";
import {
  PLANNING_CARD_FIELDS,
  PLANNING_CARD_LINKS,
  PLANNING_LEGACY_CARD_FIELDS,
  PLANNING_ZONES,
} from "./stateFingerprint.js";
import { projectOncePerTurnUsage } from "../../game/turn/oncePerTurn.js";
import type { ActionReplacementEffect } from "../../contracts/actions/shared.js";
import type { SimulatedUsageCard } from "./simStateUtils.js";
type SearchCardInput = AiCardInput;

/** Project only one card's canonical OPT evidence; retain the physical card. */
export function projectRuntimeCardEffectUsage(
  input: Pick<AiStateInput, "oncePerTurnUsage" | "oncePerTurnTurnCounter" | "turnCounter">,
  card: AiCardInput & SimulatedUsageCard,
) {
  if (!input.oncePerTurnUsage || (input.oncePerTurnTurnCounter !== undefined &&
    input.oncePerTurnTurnCounter !== input.turnCounter)) return {};
  return projectOncePerTurnUsage(input.oncePerTurnUsage.card?.get(card),
    `:card:${String(card.duelCardId ?? card.instanceId)}:presence:${String(card.oncePerTurnResetVersion || 0)}`,
    input.turnCounter);
}

/** Copy public, already-resolved destruction registrations into the planner. */
export function projectRuntimeReplacementEffects(input: AiStateInput, state: AiStateShape): void {
  const registrations: unknown = Reflect.get(input, "temporaryReplacementEffects");
  if (!Array.isArray(registrations)) return;
  const read = (value: unknown, key: string): unknown =>
    value !== null && typeof value === "object" ? Reflect.get(value, key) : undefined;
  state._simReplacementEffects = [];
  for (const entry of registrations as readonly unknown[]) {
    const raw = read(entry, "replacementEffect");
    const ownerId = read(entry, "ownerId");
    if (!raw || typeof raw !== "object" || read(raw, "type") !== "destruction" || typeof ownerId !== "string") continue;
    // The owned runtime producer supplies ActionReplacementEffect; retain only
    // its declarative fields, excluding targetCards and other live references.
    const behavior = raw as ActionReplacementEffect;
    const replacementEffect: ActionReplacementEffect = {
      type: "destruction",
      ...(behavior.reason ? { reason: behavior.reason } : {}),
      ...(behavior.targetOwner ? { targetOwner: behavior.targetOwner } : {}),
      ...(behavior.targetZones ? { targetZones: [...behavior.targetZones] } : {}),
      ...(behavior.targetRequireFaceup !== undefined ? { targetRequireFaceup: behavior.targetRequireFaceup } : {}),
      ...(behavior.targetFilters ? { targetFilters: structuredClone(behavior.targetFilters) } : {}),
      ...(behavior.costActions ? { costActions: structuredClone(behavior.costActions) } : {}),
      ...(behavior.costCount !== undefined ? { costCount: behavior.costCount } : {}),
    };
    const presences = read(raw, "targetPresences");
    const targetPresences = Array.isArray(presences) ? (presences as readonly unknown[]).flatMap(presence => {
      const instanceId = read(presence, "instanceId"); const locationVersion = read(presence, "locationVersion");
      const fieldPresenceId = read(presence, "fieldPresenceId");
      if ((typeof instanceId !== "string" && typeof instanceId !== "number") || typeof locationVersion !== "number") return [];
      return [{ instanceId, locationVersion, fieldPresenceId: typeof fieldPresenceId === "string" || typeof fieldPresenceId === "number" ? fieldPresenceId : null }];
    }) : [];
    const uniqueKey = read(entry, "uniqueKey"); const uses = read(entry, "usesRemaining"); const expiry = read(entry, "expiresOnTurn");
    state._simReplacementEffects.push({ sourcePlayerId: ownerId, replacementEffect, targetPresences,
      ...(typeof uniqueKey === "string" ? { uniqueKey } : {}),
      usesRemaining: typeof uses === "number" && Number.isFinite(uses) ? uses : null,
      expiresOnTurn: typeof expiry === "number" ? expiry : null,
    });
  }
}

/** Admit restoration only for contributions proven to have a modeled producer. */
export function hasPendingPassiveRestoration(state: Pick<AiStateInput, "bot" | "player">): boolean {
  return [state.bot, state.player].some(player => player?.field?.some(card =>
    hasUnmodeledTemporaryPassiveSuppression(card),
  ));
}

/** Snapshot canonical runtime counters without keeping their Maps/WeakMap. */
export function projectRuntimeEffectUsage(input: AiStateInput, state: AiStateShape): void {
  const runtime = input.oncePerTurnUsage;
  if (!runtime || (input.oncePerTurnTurnCounter !== undefined &&
    input.oncePerTurnTurnCounter !== input.turnCounter)) return;
  for (const original of [input.bot, input.player]) {
    if (!original?.id) continue;
    const cloned = state.bot.id === original.id ? state.bot : state.player.id === original.id ? state.player : null;
    if (!cloned) continue;
    const entries = original.id === "bot" ? runtime.bot : original.id === "player" ? runtime.player : undefined;
    cloned.oncePerTurnUsageByName = { ...cloned.oncePerTurnUsageByName, ...projectOncePerTurnUsage(entries) };
    const copyCard = (card: AiCardInput | null | undefined, target: SimulatedCardState | null | undefined) => {
      if (!card || !target) return;
      const usage = projectRuntimeCardEffectUsage(input, card);
      if (Object.keys(usage).length > 0) target.oncePerTurnUsageByName = { ...target.oncePerTurnUsageByName, ...usage };
    };
    for (const zone of PLANNING_ZONES) {
      original[zone]?.forEach((card, index) => copyCard(card, cloned[zone][index]));
    }
    copyCard(original.fieldSpell, cloned.fieldSpell);
  }
}

/**
 * Graph-copy mechanism; each planner still selects its own state/player fields.
 * Equipment shares a memo with all zones, so
 * common/zones.ts detach/move operations affect the branch's host only.
 * Beam/Greedy retain their legacy shallow metadata. GameTree selects planning
 * fields only, including on cards reached through links outside the zones.
 */
export function createPlanningCopy(planningCardsOnly = false) {
  const copies = new Map<object, unknown>();
  const planningCards = new Set<object>();

  // Deferred runtime effects retain their source Player. The planner owns a
  // selected player projection, so these links must not copy Player.game.
  function registerPlayerCopy(source: object, target: object): void {
    copies.set(source, target);
  }

  function registerCardProjection(source: SearchCardInput, projection: SearchCardInput): void {
    const clone = cloneCardForSim(projection);
    copyModeledPassiveContributions(source, clone);
    copies.set(source, clone);
  }

  function registerPlanningCard(card: object): void {
    if (planningCards.has(card)) return;
    planningCards.add(card);
    for (const key of PLANNING_CARD_LINKS) {
      const linked: unknown = Reflect.get(card, key);
      if (linked && typeof linked === "object") registerPlanningCard(linked);
    }
    const equips: unknown = Reflect.get(card, "equips");
    if (Array.isArray(equips)) {
      for (const equip of equips) {
        if (equip && typeof equip === "object") registerPlanningCard(equip);
      }
    }
  }

  function copyValue(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    if (copies.has(value)) return copies.get(value);
    if (planningCardsOnly && planningCards.has(value)) return cloneCardForSim(value);
    if (Array.isArray(value)) {
      const result: unknown[] = new Array(value.length);
      copies.set(value, result);
      value.forEach((entry, index) => {
        result[index] = copyValue(entry);
      });
      return result;
    }
    if (value instanceof Map) {
      const result = new Map<unknown, unknown>();
      copies.set(value, result);
      for (const [key, entry] of value)
        result.set(copyValue(key), copyValue(entry));
      return result;
    }
    if (value instanceof Set) {
      const result = new Set<unknown>();
      copies.set(value, result);
      for (const entry of value) result.add(copyValue(entry));
      return result;
    }
    const result = {};
    copies.set(value, result);
    for (const key of Object.keys(value)) {
      if (key === "_gameRef") continue;
      const entry: unknown = Reflect.get(value, key);
      if (typeof entry !== "function")
        Reflect.set(result, key, copyValue(entry));
    }
    copyModeledPassiveContributions(value, result);
    copyPlanningActionPresence(value, result);
    return result;
  }

  function copyFields(
    source: object,
    target: object,
    keys: readonly string[],
  ): void {
    for (const key of keys) {
      if (key in source)
        Reflect.set(target, key, copyValue(Reflect.get(source, key)));
    }
  }

  function cloneCardForSim(card: SearchCardInput): SimulatedCardState {
    if (!card || typeof card !== "object") return card;
    // Memo entries are copies of these exact input objects.
    if (copies.has(card)) return copies.get(card) as SimulatedCardState;
    if (planningCardsOnly) registerPlanningCard(card);
    const clone = planningCardsOnly ? {} : { ...card };
    copies.set(card, clone);
    copyFields(card, clone, [
      ...PLANNING_CARD_FIELDS,
      ...PLANNING_LEGACY_CARD_FIELDS,
      ...PLANNING_CARD_LINKS,
      "equips",
      "state",
    ]);
    copyModeledPassiveContributions(card, clone);
    return clone as SimulatedCardState;
  }

  return { cloneCardForSim, copyFields, copyValue, registerPlayerCopy, registerCardProjection };
}

/** Public placement fields kept by an opaque projection of a hidden card. */
export const PUBLIC_UNKNOWN_CARD_FIELDS = [
  "instanceId", "fieldPresenceId", "fieldSlot", "isFacedown", "position", "controller", "originalOwner",
] as const satisfies readonly (keyof SimulatedCardShape)[];

/**
 * Replace the opponent's hidden cards with opaque projections: Hand, Deck and
 * Extra Deck, plus face-down cards on the field, in the backrow and banished.
 * Register before copying either participant: links to the same hidden card
 * must resolve to the same opaque projection, never to a second full copy.
 */
export function registerPublicOpponentProjection(
  copy: Pick<ReturnType<typeof createPlanningCopy>, "copyFields" | "registerCardProjection">,
  opponent: AiPlayerInput,
): void {
  const hide = (card: AiCardInput | null | undefined, monster = false) => {
    if (!card) return;
    const projection: AiCardInput & { _simUnknownCard: true } = { _simUnknownCard: true };
    copy.copyFields(card, projection, PUBLIC_UNKNOWN_CARD_FIELDS);
    if (monster) projection.cardKind = "monster";
    copy.registerCardProjection(card, projection);
  };
  for (const zone of ["hand", "deck", "extraDeck"] as const) {
    for (const card of opponent[zone] || []) hide(card);
  }
  for (const card of opponent.field || []) if (card?.isFacedown) hide(card, true);
  for (const card of opponent.spellTrap || []) if (card?.isFacedown) hide(card);
  if (opponent.fieldSpell?.isFacedown) hide(opponent.fieldSpell);
  for (const card of opponent.banished || []) if (card?.isFacedown) hide(card);
}

/**
 * Allowlisted fields beyond the public placement that the TurnLineSearch root
 * copies onto an opaque projection today: projectRuntimeEffectUsage writes the
 * runtime OPT snapshot on any planning card. The guard tolerates and counts
 * them; taking one out of the projections is parity (phase 2.3 L10).
 */
export const PUBLIC_PROJECTION_TOLERATED_FIELDS = [
  "oncePerTurnUsageByName",
] as const satisfies readonly (keyof SimulatedCardShape)[];

/**
 * Fields the TurnLineSearch root copies onto an opaque projection: the public
 * placement fields and the opaque mark of registerPublicOpponentProjection,
 * plus the tolerated fields. copyModeledPassiveContributions keeps its proof
 * in a WeakMap and adds no field. A face-down monster may also keep cardKind "monster".
 */
export const PUBLIC_PROJECTION_ALLOWED_FIELDS = [
  ...PUBLIC_UNKNOWN_CARD_FIELDS, "_simUnknownCard", ...PUBLIC_PROJECTION_TOLERATED_FIELDS,
] as const satisfies readonly (keyof SimulatedCardShape)[];

const PUBLIC_PROJECTION_ALLOWED: ReadonlySet<string> = new Set(PUBLIC_PROJECTION_ALLOWED_FIELDS);
const PUBLIC_PROJECTION_TOLERATED: ReadonlySet<string> = new Set(PUBLIC_PROJECTION_TOLERATED_FIELDS);

/**
 * Structural guard of a planning root's public projection (phase 2.3, E2): it
 * counts and returns, never throws. Every hidden card of the opponent of
 * `perspectiveId` must be an opaque projection with allowlisted fields only:
 * Hand, Deck and Extra Deck, plus face-down cards on the field, in the
 * backrow, in the Field Zone and banished, as registerPublicOpponentProjection hides them.
 */
export function assertPublicPlanningProjection(
  root: Pick<AiStateShape, "player" | "bot">,
  perspectiveId: string,
): PublicProjectionGuardReport {
  const report: PublicProjectionGuardReport = { projections: 0, fields: {}, tolerated: {}, unprojected: {} };
  const opponent = root.bot?.id === perspectiveId ? root.player : root.player?.id === perspectiveId ? root.bot : null;
  if (!opponent) return report;
  const count = (counts: Record<string, number>, key: string) => {
    counts[key] = (Object.hasOwn(counts, key) ? counts[key] ?? 0 : 0) + 1;
  };
  const inspect = (card: SimulatedCardState | null | undefined, zone: string, faceDownMonster = false) => {
    if (!card) return;
    if (card._simUnknownCard !== true) {
      count(report.unprojected, zone);
      return;
    }
    report.projections += 1;
    for (const key of Object.keys(card)) {
      if (PUBLIC_PROJECTION_TOLERATED.has(key)) count(report.tolerated, key);
      if (PUBLIC_PROJECTION_ALLOWED.has(key)) continue;
      if (key === "cardKind" && faceDownMonster && card.cardKind === "monster") continue;
      count(report.fields, key);
    }
  };
  for (const zone of ["hand", "deck", "extraDeck"] as const) {
    for (const card of opponent[zone] || []) inspect(card, zone);
  }
  for (const card of opponent.field || []) if (card?.isFacedown) inspect(card, "field", true);
  for (const card of opponent.spellTrap || []) if (card?.isFacedown) inspect(card, "spellTrap");
  if (opponent.fieldSpell?.isFacedown) inspect(opponent.fieldSpell, "fieldSpell");
  for (const card of opponent.banished || []) if (card?.isFacedown) inspect(card, "banished");
  return report;
}
