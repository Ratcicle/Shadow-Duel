/**
 * destruction.js
 *
 * Handlers for banishment and destruction effects.
 * Moved from ActionHandlers.js with identical behavior.
 */

import { isAI } from "../Player.js";
import type {
  ActionOf,
  DestroyDamageEntry,
  ReplacementRegistrationEntry,
} from "../contracts/actions.js";
import type {
  ActionRuntimeCard,
  ActionRuntimeGamePort,
  ActionRuntimePlayer,
  ActionRuntimeRegistration,
  ActionHandlerEnginePort,
  EffectContext,
  NeedsSelectionResult,
  ResolvedTargetMap,
} from "../contracts/actionRuntime.js";
import type { ZoneInput } from "../contracts/zones.js";
import {
  getUI,
  resolveContextNumber,
  resolveFieldScopeCards,
  resolveTargetCards,
  buildFieldSelectionCandidates,
  selectCards,
} from "./shared.js";

const PLAYER_ARRAY_ZONES = [
  "hand",
  "field",
  "graveyard",
  "deck",
  "spellTrap",
  "extraDeck",
  "banished",
] as const;

type PlayerArrayZone = (typeof PLAYER_ARRAY_ZONES)[number];
type DamagePlayerKey = "self" | "opponent";
type DestroyDamageAction = ActionOf<"destroy_and_damage_by_target_atk"> & {
  readonly targetRef?: string;
  readonly player?: "self" | "opponent";
};
type ReplacementRegistrationAction = ActionOf<"register_replacement_effect"> & {
  readonly entries?: readonly ReplacementRegistrationEntry[];
};
type BanishAction = ActionOf<"banish" | "banish_destroyed_monster"> & {
  readonly targetRef?: string;
  readonly fromZone?: ZoneInput;
  readonly useDestroyed?: boolean;
  readonly contextLabel?: string;
  readonly effectId?: string;
  readonly haltOnFailure?: boolean;
  readonly stopOnFailure?: boolean;
};
type GraveyardBanishAction = ActionOf<"banish_card_from_graveyard"> & {
  readonly cardName?: string;
  readonly cardType?: string;
  readonly promptPlayer?: boolean;
  readonly contextLabel?: string;
  readonly effectId?: string;
  readonly movedByEffect?: boolean;
};
type BanishAllGraveyardAction = ActionOf<"banish_all_graveyard_and_burn"> & {
  readonly effectId?: string;
};
type SelectiveDestroyAction = ActionOf<
  "selective_field_destruction" | "destroy_targeted_cards"
> & {
  readonly mode?: string;
  readonly keepPerSide?: number;
  readonly allowTieBreak?: boolean;
  readonly modalTitle?: string;
  readonly modalSubtitle?: string;
  readonly modalInfoText?: string;
};

interface AnimationSource {
  rect?: object | null;
  hadCardElement?: boolean;
  visual?: object | null;
}

interface SelectiveModalConfig {
  title?: string;
  subtitle?: string | null;
  infoText?: string;
}

interface TieBreakerSelectionResult extends NeedsSelectionResult {
  actionType?: string;
  activationContext?: object | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAnimationSource(value: unknown): value is AnimationSource {
  return isRecord(value);
}

function isDestroyDamageEntry(
  value: DestroyDamageEntry | ReplacementRegistrationEntry,
): value is DestroyDamageEntry {
  return "targetRef" in value && !("replacementEffect" in value);
}

function isReplacementEntry(
  value: DestroyDamageEntry | ReplacementRegistrationEntry,
): value is ReplacementRegistrationEntry {
  return "replacementEffect" in value;
}

function isRuntimeCard(value: unknown): value is ActionRuntimeCard {
  return isRecord(value) && typeof value.name === "string";
}

function isRuntimePlayer(value: unknown): value is ActionRuntimePlayer {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.field)
  );
}

function isMoveSuccess(value: unknown): boolean {
  return value !== false && (!isRecord(value) || value.success !== false);
}

function isNeedsSelectionResult(value: unknown): value is NeedsSelectionResult {
  return isRecord(value) && value.needsSelection === true;
}

function readRecordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? Reflect.get(value, key) : undefined;
}

function findCardZoneInOwner(
  owner: ActionRuntimePlayer | null | undefined,
  card: ActionRuntimeCard | null | undefined,
): ZoneInput | null {
  if (!owner || !card) return null;
  if (owner.fieldSpell === card) return "fieldSpell";
  return (
    PLAYER_ARRAY_ZONES.find((zone) => {
      const cards = Reflect.get(owner, zone);
      return Array.isArray(cards) && cards.includes(card);
    }) || null
  );
}

function ownerZoneContainsCard(
  owner: ActionRuntimePlayer | null | undefined,
  zoneName: ZoneInput | null | undefined,
  card: ActionRuntimeCard | null | undefined,
): boolean {
  if (!owner || !zoneName || !card) return false;
  if (zoneName === "fieldSpell") return owner.fieldSpell === card;
  if (!PLAYER_ARRAY_ZONES.includes(zoneName as PlayerArrayZone)) return false;
  const cards = Reflect.get(owner, zoneName);
  return Array.isArray(cards) && cards.includes(card);
}

function findCardOwnerInGame(
  game: ActionRuntimeGamePort,
  card: ActionRuntimeCard,
): ActionRuntimePlayer | null {
  if (!game || !card) return null;

  const zones: readonly ZoneInput[] = [...PLAYER_ARRAY_ZONES, "fieldSpell"];
  const players = [game.player, game.bot].filter(Boolean);

  for (const candidate of players) {
    for (const zoneName of zones) {
      if (ownerZoneContainsCard(candidate, zoneName, card)) {
        return candidate;
      }
    }
  }

  return null;
}

function queueBanishAnimation(
  game: ActionRuntimeGamePort,
  owner: ActionRuntimePlayer,
  card: ActionRuntimeCard,
  fromZone: ZoneInput | null = null,
): void {
  if (!game?.cardAnimationsReady || typeof game.queueCardAnimation !== "function") {
    return;
  }
  if (!owner || !card || card.instanceId == null) return;

  const resolvedFromZone = fromZone || findCardZoneInOwner(owner, card);
  const rawSource = game.ui?.captureCardAnimationSource?.(card, {
    ownerId: owner.id,
    zone: resolvedFromZone,
  });

  const source = isAnimationSource(rawSource) ? rawSource : null;
  game.queueCardAnimation({
    kind: "banish",
    card,
    fromOwnerId: owner.id,
    toOwnerId: owner.id,
    fromZone: resolvedFromZone,
    toZone: "banished",
    fromRect: source?.rect || null,
    fromHadCardElement: source?.hadCardElement === true,
    fromVisual: source?.visual || null,
  });
}

function resolveDamagePlayerKey(
  entry: DestroyDamageEntry,
  card: ActionRuntimeCard,
  player: ActionRuntimePlayer,
  opponent: ActionRuntimePlayer,
): DamagePlayerKey {
  const damagePlayer = entry?.damagePlayer || entry?.player || "opponent";
  if (damagePlayer === "self" || damagePlayer === "opponent") {
    return damagePlayer;
  }
  if (damagePlayer === "owner" || damagePlayer === "target_owner") {
    if (card?.owner === player?.id) return "self";
    if (card?.owner === opponent?.id) return "opponent";
  }
  return "opponent";
}

function resolveDamageAmount(
  entry: DestroyDamageEntry,
  card: ActionRuntimeCard,
): number {
  if (typeof entry.amount === "number" && Number.isFinite(entry.amount)) {
    return Math.max(0, Math.floor(entry.amount));
  }
  const multiplier =
    typeof entry.multiplier === "number" && Number.isFinite(entry.multiplier)
      ? entry.multiplier
      : 1;
  const damageFrom = entry?.damageFrom || "target_atk";
  let base = 0;
  if (damageFrom === "target_def") {
    base = card?.def || 0;
  } else if (damageFrom === "target_level") {
    base = card?.level || 0;
  } else {
    base = card?.atk || 0;
  }
  return Math.max(0, Math.floor(base * multiplier));
}

function shouldSkipDamage(
  action: DestroyDamageAction,
  ctx: EffectContext,
  engine: ActionHandlerEnginePort,
  playerKey: DamagePlayerKey,
): boolean {
  const conditions = action?.skipDamageIf?.[playerKey];
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return false;
  }
  const targetPlayer = playerKey === "self" ? ctx.player : ctx.opponent;
  const targetOpponent = playerKey === "self" ? ctx.opponent : ctx.player;
  const condCtx = {
    ...ctx,
    player: targetPlayer,
    opponent: targetOpponent,
  };
  if (!engine.evaluateConditions) {
    throw new TypeError("engine.evaluateConditions is not a function");
  }
  const result = engine.evaluateConditions(conditions, condCtx);
  return result.ok;
}

export async function handleDestroyAndDamageByTargetAtk(
  action: DestroyDamageAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, opponent, source } = ctx;
  const game = engine.game;

  if (!player || !opponent || !game) return false;

  const entries: readonly DestroyDamageEntry[] =
    Array.isArray(action?.entries) && action.entries.length > 0
      ? action.entries.filter(isDestroyDamageEntry)
      : action?.targetRef
        ? [
            {
              targetRef: action.targetRef,
              damagePlayer: action.player === "self" ? "self" : "opponent",
            },
          ]
        : [];

  if (entries.length === 0) return false;

  const damageTotals = { self: 0, opponent: 0 };
  let destroyedAny = false;

  for (const entry of entries) {
    const targetCards = resolveTargetCards(action, ctx, targets, {
      targetRef: entry.targetRef,
      requireArray: true,
    });
    if (!targetCards.length) continue;

    const { allowed } = engine.filterCardsListByImmunity(targetCards, player, {
      actionType: action.type,
      effectType: entry.effectType || "destruction",
    });

    for (const card of allowed) {
      const result = await game.destroyCard(card, {
        cause: "effect",
        sourceCard: source || null,
        opponent,
      });

      if (!result?.destroyed) continue;

      destroyedAny = true;
      const damageKey = resolveDamagePlayerKey(entry, card, player, opponent);
      const amount = resolveDamageAmount(entry, card);
      if (amount > 0 && damageKey in damageTotals) {
        damageTotals[damageKey] += amount;
      }
    }
  }

  let dealtDamage = false;
  for (const playerKey of ["self", "opponent"] as const) {
    const amount = damageTotals[playerKey] || 0;
    if (amount <= 0) continue;
    if (shouldSkipDamage(action, ctx, engine, playerKey)) {
      getUI(game)?.log("Damage prevented by effect.");
      continue;
    }
    await engine.applyDamage({ player: playerKey, amount }, ctx);
    dealtDamage = true;
  }

  if ((destroyedAny || dealtDamage) && typeof game.updateBoard === "function") {
    game.updateBoard();
  }

  return destroyedAny || dealtDamage;
}

export async function handleRegisterReplacementEffect(
  action: ReplacementRegistrationAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, opponent, source } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const sourceName = action?.sourceName || source?.name || "Effect";
  const configuredEntries = Array.isArray(action.entries)
    ? action.entries.filter(isReplacementEntry)
    : [];
  const rawEntries: readonly ReplacementRegistrationEntry[] =
    configuredEntries.length > 0
      ? configuredEntries
      : action.replacementEffect
        ? [{ ...action }]
        : [];

  if (rawEntries.length === 0) return false;

  const resolveOwnerId = (
    ownerKey: ReplacementRegistrationEntry["owner"] | undefined,
  ): string | null => {
    if (ownerKey === "opponent") return opponent?.id || null;
    return player?.id || null;
  };

  const resolveExpiresOnTurn = (
    entry: ReplacementRegistrationEntry,
  ): number | null => {
    if (
      typeof entry.expiresOnTurn === "number" &&
      Number.isFinite(entry.expiresOnTurn)
    ) {
      return entry.expiresOnTurn;
    }
    const duration = entry?.duration || null;
    const durationTurnsRaw = entry?.durationTurns ?? entry?.turns ?? null;
    const currentTurn = Number(game.turnCounter || 0);
    if (duration === "end_of_turn") return currentTurn;
    if (duration === "end_of_next_turn") return currentTurn + 1;
    if (Number.isFinite(Number(durationTurnsRaw))) {
      return currentTurn + Number(durationTurnsRaw);
    }
    return null;
  };

  const normalizeUses = (entry: ReplacementRegistrationEntry): number => {
    if (entry?.uses === undefined && entry?.usesRemaining === undefined) {
      return Infinity;
    }
    const usesRaw = entry?.uses ?? entry?.usesRemaining;
    return Number.isFinite(Number(usesRaw))
      ? Math.max(0, Number(usesRaw))
      : Infinity;
  };

  const getReplacementTargetKey = (
    card: ActionRuntimeCard | null | undefined,
  ): string | null => {
    if (!card) return null;
    if (card.instanceId !== undefined && card.instanceId !== null) {
      return `instance:${card.instanceId}`;
    }
    const fieldPresenceId = readRecordValue(card, "fieldPresenceId");
    if (fieldPresenceId !== undefined && fieldPresenceId !== null) {
      return `presence:${String(fieldPresenceId)}`;
    }
    return null;
  };

  if (!Array.isArray(game.temporaryReplacementEffects)) {
    game.temporaryReplacementEffects = [];
  }

  let addedAny = false;

  for (const entryInput of rawEntries) {
    const replacementEffect = entryInput?.replacementEffect;
    if (!replacementEffect || typeof replacementEffect !== "object") {
      continue;
    }

    const scopedTargets = entryInput?.targetRef
      ? resolveTargetCards(entryInput, ctx, targets)
      : [];
    if (entryInput?.targetRef && scopedTargets.length === 0) {
      continue;
    }
    const targetInstanceIds = scopedTargets
      .map(getReplacementTargetKey)
      .filter(Boolean);
    const runtimeReplacementEffect =
      scopedTargets.length > 0
        ? {
            ...replacementEffect,
            targetInstanceIds,
            targetCards: scopedTargets,
          }
        : replacementEffect;

    const ownerKey = entryInput?.owner || entryInput?.targetOwner || "self";
    const ownerIds =
      ownerKey === "both"
        ? [player?.id, opponent?.id]
        : [resolveOwnerId(ownerKey)];

    for (const ownerId of ownerIds) {
      if (!ownerId) continue;

      const uniqueKey = entryInput?.uniqueKey || entryInput?.key || null;
      if (uniqueKey) {
        game.temporaryReplacementEffects =
          game.temporaryReplacementEffects.filter(
            (existing) =>
              !existing ||
              readRecordValue(existing, "uniqueKey") !== uniqueKey ||
              existing.ownerId !== ownerId,
          );
      }

      const entry = {
        id: entryInput?.id || `${sourceName}:${Date.now()}`,
        uniqueKey,
        ownerId,
        sourceName: entryInput?.sourceName || sourceName,
        replacementEffect: runtimeReplacementEffect,
        usesRemaining: normalizeUses(entryInput),
        expiresOnTurn: resolveExpiresOnTurn(entryInput),
        usesPerTarget: entryInput?.usesPerTarget === true,
        usedTargetKeys: [],
        usedTargetCards: [],
      };

      game.temporaryReplacementEffects.push(entry);
      addedAny = true;
    }
  }

  if (addedAny) {
    const logMessage = action?.logMessage;
    if (logMessage) {
      getUI(game)?.log(logMessage);
    } else {
      getUI(game)?.log(`${sourceName} is now protecting your cards.`);
    }
    if (source && typeof game.queueVisualFeedback === "function") {
      game.queueVisualFeedback({
        kind: "protect",
        sourceCard: source,
        targetCard: source,
        targetOwnerId: source.owner || player.id,
        targetZone: "field",
        tone: "blue",
      });
    }
  }

  return addedAny;
}

/**
 * Generic handler for banishing cards
 */
export async function handleBanish(
  action: BanishAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;

  const game = engine.game;

  if (!game) return false;

  const targetRef = action.targetRef;

  const initialTargets = targetRef ? targets?.[targetRef] : [];
  let resolved: ActionRuntimeCard[] = Array.isArray(initialTargets)
    ? initialTargets.filter(isRuntimeCard)
    : [];

  const useDestroyed =
    action.useDestroyed === true || action.type === "banish_destroyed_monster";

  if ((!Array.isArray(resolved) || resolved.length === 0) && useDestroyed) {
    resolved = ctx?.destroyed ? [ctx.destroyed] : [];
  }

  // Allow banishing the source card when targetRef is "self" and no targets were pre-resolved

  if (
    (!Array.isArray(resolved) || resolved.length === 0) &&
    targetRef === "self" &&
    ctx?.source
  ) {
    resolved = [ctx.source];
  }

  if (!Array.isArray(resolved) || resolved.length === 0) {
    getUI(game)?.log("Nenhum alvo válido para banish.");

    return false;
  }

  let banishedCount = 0;

  const opponent =
    player && typeof engine.getOpponent === "function"
      ? engine.getOpponent(player)
      : player && typeof game.getOpponent === "function"
        ? game.getOpponent(player)
      : null;

  for (const tgt of resolved) {
    if (!tgt) continue;

    const ownerPlayerValue = readRecordValue(tgt, "ownerPlayer");
    const fallbackOwner =
      (isRuntimePlayer(ownerPlayerValue) ? ownerPlayerValue : null) ||
      (opponent &&
      (tgt.owner === opponent.id ||
        tgt.controller === opponent.id ||
        tgt.owner === "opponent" ||
        tgt.controller === "opponent")
        ? opponent
        : player);

    const ownerPlayer =
      findCardOwnerInGame(game, tgt) ||
      (typeof engine.getOwnerByCard === "function"
        ? engine.getOwnerByCard(tgt)
        : typeof engine.getOwnerOfCard === "function"
          ? engine.getOwnerOfCard(tgt)
          : null) ||
      fallbackOwner;

    let resolvedOwner = ownerPlayer;

    if (!resolvedOwner && ctx?.destroyedOwner && tgt === ctx.destroyed) {
      resolvedOwner =
        typeof ctx.destroyedOwner === "string"
          ? ctx.destroyedOwner === game.player?.id
            ? game.player
            : ctx.destroyedOwner === game.bot?.id
              ? game.bot
              : null
          : ctx.destroyedOwner;
    }

    if (!resolvedOwner) {
      const allZones: readonly ZoneInput[] = [
        "hand",
        "field",
        "graveyard",
        "deck",
        "spellTrap",
        "fieldSpell",
        "banished",
      ];
      const candidates = [game.player, game.bot].filter(Boolean);
      for (const candidate of candidates) {
        for (const zoneName of allZones) {
          if (zoneName === "fieldSpell") {
            if (candidate.fieldSpell === tgt) {
              resolvedOwner = candidate;
              break;
            }
            continue;
          }
          if (!PLAYER_ARRAY_ZONES.includes(zoneName as PlayerArrayZone)) {
            continue;
          }
          const zoneArr = candidate[zoneName as PlayerArrayZone];
          if (Array.isArray(zoneArr) && zoneArr.includes(tgt)) {
            resolvedOwner = candidate;
            break;
          }
        }
        if (resolvedOwner) break;
      }
    }

    if (!resolvedOwner) {
      getUI(game)?.log(`Não foi possível determinar o dono de ${tgt.name}.`);

      continue;
    }

    if (
      action.fromZone &&
      !ownerZoneContainsCard(resolvedOwner, action.fromZone, tgt)
    ) {
      getUI(game)?.log(
        `${tgt.name} não está mais em ${action.fromZone}; não pode ser banida.`,
      );

      continue;
    }

    const fromZone = action.fromZone || findCardZoneInOwner(resolvedOwner, tgt);
    const moveResult = await game.moveCard(tgt, resolvedOwner, "banished", {
      fromZone,
      contextLabel: action.contextLabel || "banish",
      sourceCard: ctx?.source || null,
      sourcePlayer: ctx?.player || null,
      effectId: ctx?.effect?.id || action.effectId || null,
      movedByEffect: true,
      awaitCardMovedEvent: true,
    });

    if (!isMoveSuccess(moveResult)) {
      getUI(game)?.log(`${tgt.name} could not be banished.`);
      continue;
    }

    banishedCount += 1;

    getUI(game)?.log(`${tgt.name} foi banida.`);
  }

  if (banishedCount > 0) {
    game.updateBoard();

    return true;
  }

  return false;
}

/**
 * Schedules a delayed return summon for a banished card.
 * Used by effects that banish a card "until the end of the next turn"
 * (e.g. Galaxy Extreme Dragon's once-per-Duel self-banish).
 *
 * Action properties:
 * - cardRef: which card to return (default: "self" — the source card)
 * - returnPhase: phase when the return happens (default: "end")
 * - delayTurns: number of full turns to wait before returning (default: 1)
 *   With delayTurns=1 from your own turn, the return fires on the next
 *   end-of-opponent-turn, which is "the end of the next turn" by Yu-Gi-Oh!
 *   timing rules.
 */
export async function handleScheduleReturnFromBanished(
  action: ActionOf<"schedule_return_from_banished">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  const { player, source } = ctx || {};
  if (!game || !player) return false;

  const cardRef = action?.cardRef || "self";
  let cardToReturn: ActionRuntimeCard | null = null;
  if (cardRef === "self") {
    cardToReturn = source || null;
  } else if (Array.isArray(targets?.[cardRef]) && targets[cardRef].length > 0) {
    const candidate = targets[cardRef][0];
    cardToReturn = isRuntimeCard(candidate) ? candidate : null;
  }

  if (!cardToReturn) {
    getUI(game)?.log("No card to schedule for return from banished.");
    return false;
  }

  const returnPhase = action?.returnPhase || "end";
  const delayTurns =
    typeof action.delayTurns === "number" && Number.isFinite(action.delayTurns)
      ? action.delayTurns
      : 1;

  // "End of the next turn" means the end-phase of the turn that follows the
  // current one. `game.turn` is the active player at the moment of scheduling,
  // so the next turn belongs to the other player when delayTurns is odd.
  const currentTurnPlayer = game.turn;
  const otherTurnPlayer = currentTurnPlayer === "player" ? "bot" : "player";
  const triggerPlayerId =
    delayTurns % 2 === 1 ? otherTurnPlayer : currentTurnPlayer;

  const summonPayload = {
    summons: [
      {
        card: cardToReturn,
        owner: player.id,
        fromZone: "banished",
      },
    ],
  };

  game.scheduleDelayedAction(
    "delayed_summon",
    {
      phase: returnPhase,
      player: triggerPlayerId,
    },
    summonPayload,
    1,
  );

  getUI(game)?.log(
    `${cardToReturn.name} is banished until the end of the next turn.`,
  );

  return true;
}

/**
 * Handler for banishing a specific card from the graveyard as a cost.
 * This is used for destruction negation costs and similar effects.
 *
 * Action properties:
 * - cardName: name of the card to banish (required)
 * - count: number of cards to banish (default: 1)
 * - cardType: optional type filter (e.g., "Dragon")
 * - promptPlayer: whether to let player choose (default: true for multiple matches)
 */
export async function handleBanishCardFromGraveyard(
  action: GraveyardBanishAction,

  ctx: EffectContext,

  targets: ResolvedTargetMap,

  engine: ActionHandlerEnginePort,
) {
  const { player } = ctx;

  const game = engine.game;

  if (!player || !game) return false;

  const cardName = action.cardName;

  const cardType = action.cardType || action.type;

  const count = typeof action.count === "number" ? action.count : 1;

  // Find matching cards in the graveyard

  const graveyard = player.graveyard || [];

  let candidates = graveyard.filter((card) => {
    if (!card) return false;

    if (cardName && card.name !== cardName) return false;

    if (cardType && card.type !== cardType) return false;

    return true;
  });

  if (candidates.length < count) {
    const filterDesc = cardName || cardType || "matching card";

    getUI(game)?.log(
      `Not enough ${filterDesc} in graveyard to banish (need ${count}, found ${candidates.length}).`,
    );

    return false;
  }

  // Select cards to banish

  let toBanish: ActionRuntimeCard[] = [];

  if (candidates.length === count) {
    // Exactly enough cards, no choice needed

    toBanish = candidates.slice(0, count);
  } else if (action.promptPlayer !== false && player === game.player) {
    // Player can choose which cards to banish

    const ui = getUI(game);

    if (ui?.showCardSelectionPrompt) {
      const selected = await ui.showCardSelectionPrompt({
        cards: candidates,

        min: count,

        max: count,

        message: `Select ${count} card(s) to banish from graveyard as cost`,

        zone: "graveyard",
      });

      toBanish = Array.isArray(selected)
        ? selected.filter(isRuntimeCard)
        : [];
    } else {
      toBanish = candidates.slice(0, count);
    }
  } else {
    // Bot or auto-select: take first matching cards

    toBanish = candidates.slice(0, count);
  }

  if (toBanish.length < count) {
    getUI(game)?.log(`Cost not paid: not enough cards selected to banish.`);

    return false;
  }

  // Perform the banish

  let banishedCount = 0;

  for (const card of toBanish) {
    if (!player.graveyard.includes(card)) continue;

    const moveResult = await game.moveCard(card, player, "banished", {
      fromZone: "graveyard",
      contextLabel: action.contextLabel || "graveyard_banish_cost",
      sourceCard: ctx?.source || null,
      sourcePlayer: ctx?.player || null,
      effectId: ctx?.effect?.id || action.effectId || null,
      movedByEffect: action.movedByEffect === true,
      awaitCardMovedEvent: true,
    });

    if (!isMoveSuccess(moveResult)) {
      getUI(game)?.log(`${card.name} could not be banished from the graveyard.`);
      continue;
    }

    banishedCount++;

    getUI(game)?.log(`${card.name} was banished from the graveyard.`);
  }

  if (banishedCount > 0) {
    game.updateBoard();

    return true;
  }

  return false;
}

function resolveGraveyardBanishOwners(
  scope: "self" | "opponent" | "both",
  player: ActionRuntimePlayer,
  opponent: ActionRuntimePlayer | null | undefined,
): ActionRuntimePlayer[] {
  if (scope === "both") {
    return [player, opponent].filter(
      (owner): owner is ActionRuntimePlayer => owner !== null && owner !== undefined,
    );
  }
  if (scope === "opponent") {
    return opponent ? [opponent] : [];
  }
  return player ? [player] : [];
}

/**
 * Banishes all cards in the selected graveyard scope, then inflicts damage to
 * the target player equal to damagePerCard times the number of cards banished.
 *
 * Action properties:
 * - scope: "self" | "opponent" | "both" - graveyard scope to banish (default: "self")
 * - damagePerCard: LP damage per card banished (default: 0)
 * - player: "self" | "opponent" - who takes the damage (default: "opponent")
 */
export async function handleBanishAllGraveyardAndBurn(
  action: BanishAllGraveyardAction,
  ctx: EffectContext,
  _targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, opponent } = ctx;
  const game = engine.game;

  if (!player || !game) return false;

  const scope = action.scope || "self";
  const owners = resolveGraveyardBanishOwners(scope, player, opponent);
  const toBanish = owners.flatMap((owner) =>
    (owner.graveyard || []).map((card) => ({ owner, card })),
  );

  if (toBanish.length === 0) {
    getUI(game)?.log("No cards in the selected Graveyard scope to banish.");
    return false;
  }

  const damagePerCard = action.damagePerCard ?? 0;
  const targetPlayer = action.player === "self" ? player : ctx.opponent;

  let banishedCount = 0;

  for (const { owner, card } of toBanish) {
    if (!card || !(owner.graveyard || []).includes(card)) {
      continue;
    }

    let moved = false;
    if (typeof game.moveCard === "function") {
      const moveResult = await game.moveCard(card, owner, "banished", {
        fromZone: "graveyard",
        contextLabel: "banish_all_graveyard_and_burn",
        sourceCard: ctx?.source || null,
        sourcePlayer: ctx?.player || null,
        effectId: ctx?.effect?.id || action.effectId || null,
        movedByEffect: true,
        awaitCardMovedEvent: true,
      });
      moved = isMoveSuccess(moveResult);
      if (!moved) {
        getUI(game)?.log(`${card.name} could not be banished from the graveyard.`);
        continue;
      }
    }

    if (!moved) {
      const idx = (owner.graveyard || []).indexOf(card);
      if (idx === -1) {
        continue;
      }
      queueBanishAnimation(game, owner, card, "graveyard");
      owner.graveyard.splice(idx, 1);
      owner.banished = owner.banished || [];
      owner.banished.push(card);
      card.location = "banished";
      card.isFacedown = false;
      Reflect.set(card, "setTurn", null);
      Reflect.set(card, "turnSetOn", null);
      moved = true;
    }

    if (moved) {
      banishedCount++;
      getUI(game)?.log(`${card.name} was banished from the graveyard.`);
      game.updateBoard?.();
    }
  }

  if (banishedCount === 0) {
    return false;
  }

  const totalDamage = banishedCount * damagePerCard;
  if (totalDamage > 0 && targetPlayer) {
    if (typeof game.inflictDamage === "function") {
      game.inflictDamage(targetPlayer, totalDamage, {
        cause: "effect",
        sourceCard: ctx.source || null,
      });
    } else {
      if (!targetPlayer.takeDamage) {
        throw new TypeError("targetPlayer.takeDamage is not a function");
      }
      targetPlayer.takeDamage(totalDamage, {
        cause: "effect",
      });
    }
    getUI(game)?.log(
      `${targetPlayer.id} takes ${totalDamage} damage (${banishedCount} x ${damagePerCard}).`,
    );
  }

  game.updateBoard();
  return true;
}

/**
 * Generic handler for selective field destruction based on highest ATK
 * Implements effects like "Void Lost Throne"
 *
 * Action properties:
 * - keepPerSide: number of highest ATK monsters to keep per side (default: 1)
 * - allowTieBreak: boolean - if true, player chooses which to keep on ties (default: true)
 * - modalTitle: string - custom modal title (default: "Choose Survivor")
 * - modalSubtitle: string - custom subtitle template (default: auto-generated)
 * - modalInfoText: string - custom info text (default: "All other monsters will be destroyed.")
 *
 * Effect: Destroys all monsters on field except keepPerSide highest ATK monsters per side.
 * If there's a tie for highest ATK, the card's controller chooses which to keep.
 */
async function destroySelectiveField(
  action: SelectiveDestroyAction,
  ctx: EffectContext,
  _targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, source } = ctx;

  const game = engine.game;

  if (!player || !game) return false;

  if (!game.getOpponent) {
    throw new TypeError("game.getOpponent is not a function");
  }
  const getOpponent = game.getOpponent.bind(game);
  const opponent = getOpponent(player);

  if (!opponent) return false;

  const keepPerSide =
    typeof action.keepPerSide === "number" &&
    Number.isFinite(action.keepPerSide)
      ? action.keepPerSide
      : 1;

  const allowTieBreak = action.allowTieBreak !== false;

  // Get all monsters on both sides

  const playerMonsters = (player.field || []).filter(
    (card) => card && card.cardKind === "monster" && !card.isFacedown,
  );

  const opponentMonsters = (opponent.field || []).filter(
    (card) => card && card.cardKind === "monster" && !card.isFacedown,
  );

  if (playerMonsters.length === 0 && opponentMonsters.length === 0) {
    getUI(game)?.log("No monsters on the field to destroy.");

    return false;
  }

  // Helper function to find highest ATK monsters

  const findHighestAtkMonsters = (
    monsters: readonly ActionRuntimeCard[],
  ): ActionRuntimeCard[] => {
    if (monsters.length === 0) return [];

    const maxAtk = Math.max(...monsters.map((m) => m.atk || 0));

    return monsters.filter((m) => (m.atk || 0) === maxAtk);
  };

  // Find highest ATK monsters on each side

  const playerHighest = findHighestAtkMonsters(playerMonsters);

  const opponentHighest = findHighestAtkMonsters(opponentMonsters);

  // Determine which monsters to keep

  let playerToKeep: ActionRuntimeCard[] = [];

  let opponentToKeep: ActionRuntimeCard[] = [];

  // Custom modal text from action properties

  const modalConfig: SelectiveModalConfig = {
    title: action.modalTitle || "Choose Survivor",

    subtitle: action.modalSubtitle || null, // null means auto-generate

    infoText: action.modalInfoText || "All other monsters will be destroyed.",
  };

  if (keepPerSide > 0) {
    // Handle player's side

    if (playerHighest.length <= keepPerSide) {
      playerToKeep = playerHighest;
    } else if (allowTieBreak) {
      if (isAI(player)) {
        playerToKeep = playerHighest.slice(0, keepPerSide);
      } else {
        const tieBreakerResult = await promptTieBreaker(
          game,

          playerHighest,

          keepPerSide,

          "your",

          modalConfig,
        );
        // Check if this is a needsSelection result (network mode)
        if (isNeedsSelectionResult(tieBreakerResult)) {
          return {
            ...tieBreakerResult,
            actionType: action.type,
            activationContext: ctx?.activationContext || null,
          };
        }
        playerToKeep = tieBreakerResult;
      }
    } else {
      playerToKeep = playerHighest.slice(0, keepPerSide);
    }

    // Handle opponent's side

    if (opponentHighest.length <= keepPerSide) {
      opponentToKeep = opponentHighest;
    } else if (allowTieBreak) {
      if (isAI(player)) {
        opponentToKeep = opponentHighest.slice(0, keepPerSide);
      } else {
        const opponentTieBreakerResult = await promptTieBreaker(
          game,

          opponentHighest,

          keepPerSide,

          "opponent's",

          modalConfig,
        );
        // Check if this is a needsSelection result (network mode)
        if (isNeedsSelectionResult(opponentTieBreakerResult)) {
          return {
            ...opponentTieBreakerResult,
            actionType: action.type,
            activationContext: ctx?.activationContext || null,
          };
        }
        opponentToKeep = opponentTieBreakerResult;
      }
    } else {
      opponentToKeep = opponentHighest.slice(0, keepPerSide);
    }
  }

  // Determine which monsters to destroy

  const toDestroy: Array<{
    card: ActionRuntimeCard;
    owner: ActionRuntimePlayer;
  }> = [];

  for (const monster of playerMonsters) {
    if (!playerToKeep.includes(monster)) {
      toDestroy.push({ card: monster, owner: player });
    }
  }

  for (const monster of opponentMonsters) {
    if (!opponentToKeep.includes(monster)) {
      toDestroy.push({ card: monster, owner: opponent });
    }
  }

  if (toDestroy.length === 0) {
    getUI(game)?.log("No monsters were destroyed.");

    return false;
  }

  // Filter out immune monsters before destroying

  // For each entry, check if the card is immune to the source player's effects

  const toDestroyFiltered = toDestroy.filter(({ card, owner }) => {
    // Only filter opponent's monsters - player's own monsters are not protected by opponent immunity

    if (owner.id === player.id) return true;

    // Check if opponent's monster is immune to player's effect

    const isImmune = engine.isImmuneToOpponentEffects(card, player);

    if (isImmune && getUI(game)?.log) {
      getUI(game)?.log(
        `${card.name} is immune to opponent's effects and was not destroyed.`,
      );
    }

    return !isImmune;
  });

  if (toDestroyFiltered.length === 0) {
    getUI(game)?.log("No monsters were destroyed (all targets are immune).");

    return false;
  }

  // Destroy all marked monsters

  getUI(game)?.log(
    `Destroying ${toDestroyFiltered.length} monster(s) on the field...`,
  );

  for (const { card, owner } of toDestroyFiltered) {
    await game.destroyCard(card, {
      cause: "effect",

      sourceCard: source,

      opponent: getOpponent(owner),
    });
  }

  // Log which monsters survived

  const survivorNames = [
    ...playerToKeep.map((m) => m.name),

    ...opponentToKeep.map((m) => m.name),
  ];

  if (survivorNames.length > 0) {
    getUI(game)?.log(`${survivorNames.join(", ")} survived with highest ATK.`);
  }

  game.updateBoard();

  return true;
}

/**
 * Helper function to prompt player for tie-breaker selection
 * @param {Object} modalConfig - Configuration for modal text (title, subtitle, infoText)
 */
async function promptTieBreaker(
  game: ActionRuntimeGamePort,
  candidates: readonly ActionRuntimeCard[],
  keepCount: number,
  sideDescription: string,
  modalConfig: SelectiveModalConfig = {},
): Promise<ActionRuntimeCard[] | TieBreakerSelectionResult> {
  const ui = getUI(game);
  if (!ui.showCardGridSelectionModal) {
    // Fallback: auto-select first N

    return candidates.slice(0, keepCount);
  }

  return new Promise<ActionRuntimeCard[] | TieBreakerSelectionResult>((resolve) => {
    const maxAtk = candidates[0]?.atk || 0;

    // Use custom subtitle or generate default one

    const subtitle =
      modalConfig.subtitle ||
      `Multiple monsters on ${sideDescription} side have ${maxAtk} ATK. Choose ${keepCount} to keep on the field.`;

    const baseOptions = {
      title: modalConfig.title || "Choose Survivor",

      subtitle,

      cards: candidates,

      keepCount,

      infoText: modalConfig.infoText || "All other monsters will be destroyed.",

      onConfirm: (selected: unknown) => {
        if (isNeedsSelectionResult(selected)) {
          resolve(selected);
          return;
        }
        resolve(
          Array.isArray(selected)
            ? selected.filter(isRuntimeCard)
            : candidates.slice(0, keepCount),
        );
      },

      onCancel: () => {
        resolve(candidates.slice(0, keepCount));
      },
    };

    const showTieBreakerSelection = Reflect.get(ui, "showTieBreakerSelection");
    if (typeof showTieBreakerSelection === "function") {
      Reflect.apply(showTieBreakerSelection, ui, [baseOptions]);

      return;
    }

    ui.showCardGridSelectionModal!({
      title: baseOptions.title,

      subtitle: baseOptions.subtitle,

      cards: baseOptions.cards,

      minSelect: keepCount,

      maxSelect: keepCount,

      confirmLabel: "Confirm",

      cancelLabel: "Cancel",

      overlayClass: "tie-breaker-overlay",

      modalClass: "tie-breaker-modal",

      gridClass: "tie-breaker-grid",

      cardClass: "tie-breaker-card",

      infoText: baseOptions.infoText,

      onConfirm: baseOptions.onConfirm,

      onCancel: baseOptions.onCancel,
    });
  });
}

/**
 * Generic handler for destroying targeted cards with optional selective field mode
 */
export async function handleDestroyTargetedCards(
  action: SelectiveDestroyAction,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const { player, opponent, source } = ctx;

  const game = engine.game;

  if (!player || !opponent || !source) return false;

  const useSelectiveField =
    action?.type === "selective_field_destruction" ||
    action?.mode === "selective_field" ||
    Number.isFinite(action?.keepPerSide);

  if (useSelectiveField) {
    return await destroySelectiveField(action, ctx, targets, engine);
  }

  if (action?.targetRef) {
    const declaredTargets = resolveTargetCards(action, ctx, targets).filter(Boolean);
    if (declaredTargets.length === 0) {
      getUI(game)?.log("No declared destruction target remains available.");
      return false;
    }
    const { allowed } = engine.filterCardsListByImmunity(
      declaredTargets,
      player,
      { actionType: "destroy_targeted_cards", sourceCard: source },
    );
    for (const card of allowed) {
      const result = await game.destroyCard(card, {
        cause: "effect",
        sourceCard: source,
        opponent: player,
      });
      if (result?.destroyed) {
        getUI(game)?.log(`${source.name} destroyed ${card.name}!`);
      }
    }
    game.updateBoard();
    return allowed.length > 0;
  }

  // Build candidate list based on optional zone and kind filters

  const zones = Array.isArray(action.zones)
    ? action.zones
    : ["field", "spellTrap", "fieldSpell"];

  let opponentCards: ActionRuntimeCard[] = [];

  for (const z of zones) {
    if (z === "field") {
      opponentCards.push(...(opponent.field || []));
    } else if (z === "spellTrap") {
      opponentCards.push(...(opponent.spellTrap || []));
    } else if (z === "fieldSpell") {
      if (opponent.fieldSpell) opponentCards.push(opponent.fieldSpell);
    }
  }

  // Filter by cardKind when provided (supports array)

  if (action.cardKind) {
    const allowedKinds = Array.isArray(action.cardKind)
      ? action.cardKind
      : [action.cardKind];

    opponentCards = opponentCards.filter(
      (c) => c && allowedKinds.includes(c.cardKind),
    );
  }

  // Optional subtype filter (e.g., field, equip)

  if (action.subtype) {
    const allowedSubtypes = Array.isArray(action.subtype)
      ? action.subtype
      : [action.subtype];

    opponentCards = opponentCards.filter(
      (c) => c && c.subtype && allowedSubtypes.includes(c.subtype),
    );
  }

  if (action.requireFaceup === true) {
    opponentCards = opponentCards.filter((c) => c && !c.isFacedown);
  }

  if (action.position && action.position !== "any") {
    opponentCards = opponentCards.filter((c) => c?.position === action.position);
  }

  if (action.filters && Object.keys(action.filters).length > 0) {
    opponentCards = opponentCards.filter((c) => {
      if (!c) return false;
      if (typeof engine.cardMatchesFilters !== "function") return true;
      return engine.cardMatchesFilters(c, action.filters);
    });
  }

  if (opponentCards.length === 0) {
    getUI(game)?.log("Opponent has no cards to destroy.");

    return false;
  }

  // action.maxTargets: maximum cards to target (default 1)
  // action.minTargets: minimum required targets (default maxTargets)

  const contextTargetCount = action.targetCountFromContext
    ? Math.max(
        0,
        Math.floor(
          resolveContextNumber(action.targetCountFromContext, ctx, {
            round: "floor",
          }),
        ),
      )
    : null;

  if (contextTargetCount !== null && contextTargetCount <= 0) {
    getUI(game)?.log(`${source.name} removed too few counters to destroy a card.`);
    return false;
  }

  const requestedMaxTargets =
    contextTargetCount !== null ? contextTargetCount : action.maxTargets || 1;
  const requestedMinTargets =
    contextTargetCount !== null
      ? requestedMaxTargets
      : typeof action.minTargets === "number" &&
          Number.isFinite(action.minTargets)
        ? action.minTargets
        : Math.min(requestedMaxTargets, opponentCards.length);

  if (contextTargetCount === null && opponentCards.length < requestedMinTargets) {
    getUI(game)?.log(
      `${source.name} requires ${requestedMinTargets} valid target(s) to destroy.`,
    );
    return false;
  }

  const maxTargets = Math.min(requestedMaxTargets, opponentCards.length);
  const minTargets = Math.min(requestedMinTargets, maxTargets);

  getUI(game)?.log(
    `${source.name}: Select up to ${maxTargets} opponent cards to destroy.`,
  );

  // Build candidates list for selection contract

  const candidates = buildFieldSelectionCandidates(
    opponent,

    game,

    opponentCards,
  );

  const selectionContract = {
    kind: "target",

    message: `Select ${maxTargets} opponent card(s) to destroy.`,

    requirements: [
      {
        id: "destroy_targets",

        min: minTargets,

        max: maxTargets,

        zones: [...new Set(zones)],

        owner: "opponent",

        filters: {},

        allowSelf: true,

        distinct: true,

        candidates,
      },
    ],

    ui: { useFieldTargeting: true },

    metadata: { context: "destroy_targets" },
  };

  const selectedKeys = await selectCards({
    game,

    player,

    selectionContract,

    requirementId: "destroy_targets",

    kind: "target",

    autoSelectorOptions: {
      owner: player,

      activationContext: ctx.activationContext,

      selectionKind: "target",
    },

    autoSelectKeys: () =>
      candidates
        .slice(0, maxTargets)
        .map((cand) => cand.key)
        .filter((key): key is string => typeof key === "string"),
  });

  if (selectedKeys === null) {
    getUI(game)?.log("Target selection cancelled.");

    return false;
  }

  const targetCards: ActionRuntimeCard[] = selectedKeys

    .map((key) => candidates.find((cand) => cand.key === key)?.cardRef)

    .filter(isRuntimeCard);

  if (targetCards.length === 0) {
    getUI(game)?.log("No cards selected.");

    return false;
  }

  // Filter out immune cards before destroying

  const { allowed: nonImmuneTargets } = engine.filterCardsListByImmunity(
    targetCards,

    player,

    { actionType: "destroy_targeted_cards", sourceCard: source },
  );

  if (nonImmuneTargets.length === 0) {
    getUI(game)?.log("All selected targets are immune to effects.");

    return false;
  }

  for (const card of nonImmuneTargets) {
    const result = await game.destroyCard(card, {
      cause: "effect",

      sourceCard: source,

      opponent: player,
    });

    if (result?.destroyed) {
      getUI(game)?.log(`${source.name} destroyed ${card.name}!`);
    }
  }

  game.updateBoard();

  return true;
}

export async function handleDestroyCardsByScope(
  action: ActionOf<"destroy_cards_by_scope">,
  ctx: EffectContext,
  targets: ResolvedTargetMap,
  engine: ActionHandlerEnginePort,
) {
  const game = engine?.game;
  const { player, source } = ctx || {};

  if (!game || !player || !source) return false;
  if (!action?.targetScope) {
    getUI(game)?.log("No destruction scope configured.");
    return false;
  }

  let targetCards = resolveFieldScopeCards(action.targetScope, ctx, game, {
    engine,
  });

  if (targetCards.length === 0) {
    getUI(game)?.log("No cards matched the destruction scope.");
    return false;
  }

  if (typeof engine.filterCardsListByImmunity === "function") {
    targetCards = engine.filterCardsListByImmunity(targetCards, player, {
      actionType: action.type,
      effectType: action.effectType || engine.inferEffectType?.(action.type),
      sourceCard: source,
    }).allowed;
  }

  if (targetCards.length === 0) {
    getUI(game)?.log("All matching cards are immune to effects.");
    return false;
  }

  let destroyedCount = 0;

  for (const card of targetCards) {
    const result = await game.destroyCard(card, {
      cause: action.cause || "effect",
      sourceCard: source,
      opponent: player,
    });

    if (result?.destroyed) {
      destroyedCount += 1;
      getUI(game)?.log(`${source.name} destroyed ${card.name}!`);
    }
  }

  if (destroyedCount > 0) {
    const drawPerDestroyed = Math.max(0, Number(action.drawPerDestroyed || 0));
    const drawAmount = Math.floor(destroyedCount * drawPerDestroyed);
    const drawPlayer = action.drawPlayer === "opponent" ? ctx?.opponent : player;

    if (drawAmount > 0 && drawPlayer) {
      let drawnCards = [];
      if (typeof game.drawCards === "function") {
        const drawResult = await game.drawCards(drawPlayer, drawAmount);
        drawnCards = Array.isArray(drawResult?.drawn)
          ? drawResult.drawn.slice()
          : [];
      } else if (typeof drawPlayer.draw === "function") {
        for (let i = 0; i < drawAmount; i += 1) {
          const drawn = drawPlayer.draw();
          if (drawn) drawnCards.push(drawn);
        }
      }

      if (drawnCards.length > 0 && typeof game.emit === "function") {
        await game.emit("cards_added_to_hand", {
          player: drawPlayer,
          cards: drawnCards,
          fromZone: "deck",
          sourceCard: source,
          effectId: ctx?.effect?.id || null,
        });
      }

      getUI(game)?.log(
        `${source.name} drew ${drawnCards.length} card(s) for ${destroyedCount} destroyed card(s).`,
      );
    }

    game.updateBoard?.();
  }

  return destroyedCount > 0;
}

/**
 * Handler for destroying the attacker when an archetype monster is destroyed in battle
 */
export async function handleDestroyAttackerOnArchetypeDestruction(
  action: ActionOf<"destroy_attacker_on_archetype_destruction">,

  ctx: EffectContext,

  targets: ResolvedTargetMap,

  engine: ActionHandlerEnginePort,
) {
  const { destroyed, attacker } = ctx;

  const game = engine.game;

  if (!destroyed || !attacker || !game || !ctx.player) return false;

  const archetype = action.archetype;
  if (!archetype) {
    console.warn(
      "[handleDestroyAttackerOnArchetypeDestruction] archetype is required in action",
    );
    return false;
  }

  const minLevel = action.minLevel || 1;

  // Validate destroyed card archetype and level

  const destroyedArchetypes = Array.isArray(destroyed.archetypes)
    ? destroyed.archetypes
    : destroyed.archetype
      ? [destroyed.archetype]
      : [];

  if (!destroyedArchetypes.includes(archetype)) return false;

  const destroyedLevel = destroyed.level || 0;

  if (destroyedLevel < minLevel) return false;

  // Validate attacker is opponent's monster

  const attackerOwner = engine.getOwnerByCard(attacker);

  if (!attackerOwner || attackerOwner.id === ctx.player.id) return false;

  // Check if attacker is immune to opponent's effects

  if (engine.isImmuneToOpponentEffects(attacker, ctx.player)) {
    getUI(game)?.log(`${attacker.name} is immune to opponent's effects.`);

    return false;
  }

  const result = await game.destroyCard(attacker, {
    cause: "effect",

    sourceCard: ctx.source || destroyed,

    opponent: ctx.player,
  });

  if (!result?.destroyed) return false;

  getUI(game)?.log(`${attacker.name} was sent to the Graveyard as punishment!`);

  game.updateBoard();

  return true;
}
