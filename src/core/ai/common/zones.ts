import { restoreFieldExitStatuses, restoreTemporaryStatuses } from "../../Card.js";
import { cardMatchesFilter } from "./cardFilters.js";
import { clearPermanentStatBuffs, expireFaceupStatBuffs, removeTrackedStatChange } from "../../effects/actions/stats.js";
import { getSendToGraveReplacementDestination, refreshEquipExtraAttackBonus, removeFieldAuraBuffContributions } from "../../effects/passives/passiveBuffs.js";
import {
  assignAutomaticFieldSlot,
  clearFieldSlot,
  getAvailableFieldSlots,
} from "../../game/zones/placement.js";
import type { FieldSlot } from "../../contracts/placement.js";
import type { FieldPresenceSummonRecord } from "../../contracts/cards.js";
import type {
  AiCardInput,
  AiPlayerInput,
  AiStateInput,
  AiStateShape,
  SimulatedCardState,
  SimulatedPlayerState,
} from "../../contracts/aiState.js";

type SimulatedArrayZone =
  | "hand"
  | "field"
  | "graveyard"
  | "spellTrap"
  | "banished"
  | "deck"
  | "extraDeck";
type SimulatedZone = SimulatedArrayZone | "fieldSpell";

interface SimulatedPositionedCard {
  fieldPresenceSummons?: FieldPresenceSummonRecord[];
  fieldSlot?: FieldSlot | null;
  fieldPresenceId?: string | number | null;
  locationVersion?: number;
  duelCardId?: string | number | null;
  instanceId?: string | number | null;
  _instanceId?: string | number | null;
  id?: number | undefined;
}

/** New simulated entries use their own canonical slots, never live/UI state. */
export function appendSimulatedFieldCard<Card extends SimulatedPositionedCard>(
  cards: Card[],
  card: NoInfer<Card>,
  preserveFieldPresence = false,
): boolean {
  if (cards.includes(card)) {
    getAvailableFieldSlots(cards);
    return true;
  }
  if (assignAutomaticFieldSlot(card, cards) === null) return false;
  if (!preserveFieldPresence) {
    card.locationVersion = (card.locationVersion || 0) + 1;
    card.fieldPresenceId ??= `sim_field_${card.duelCardId ?? card.instanceId ?? card._instanceId ?? card.id}_${card.locationVersion}`;
  }
  cards.push(card);
  return true;
}

export function clearSimulatedFieldPosition(card: SimulatedPositionedCard): void {
  clearFieldSlot(card);
  card.fieldPresenceId = null;
  card.fieldPresenceSummons = [];
}

/** Off-field insertion clears only this card, without compacting survivors. */
export function appendSimulatedZoneCard<Card extends SimulatedPositionedCard>(
  cards: Card[],
  card: NoInfer<Card>,
): number {
  clearSimulatedFieldPosition(card);
  return cards.push(card);
}

interface SimulatedEquipAction {
  atkBonus?: number;
  defBonus?: number;
  extraAttacks?: number;
  battleIndestructible?: boolean;
  grantCrescentShieldGuard?: boolean;
}

export function getZoneCards(
  player: SimulatedPlayerState | null | undefined,
  zone: string,
): SimulatedCardState[] {
  if (!player) return [];
  switch (zone) {
    case "field":
      return Array.isArray(player.field) ? player.field : [];
    case "hand":
      return Array.isArray(player.hand) ? player.hand : [];
    case "graveyard":
      return Array.isArray(player.graveyard) ? player.graveyard : [];
    case "deck":
      return Array.isArray(player.deck) ? player.deck : [];
    case "spellTrap":
      return Array.isArray(player.spellTrap) ? player.spellTrap : [];
    case "fieldSpell":
      return player.fieldSpell ? [player.fieldSpell] : [];
    case "banished":
      return Array.isArray(player.banished) ? player.banished : [];
    case "extraDeck":
      return Array.isArray(player.extraDeck) ? player.extraDeck : [];
    default:
      return [];
  }
}

export function findCardZone(
  player: AiPlayerInput | null | undefined,
  card: AiCardInput | null | undefined,
): SimulatedZone | null {
  if (!player || !card) return null;
  if (player.fieldSpell === card) return "fieldSpell";
  for (const zone of [
    "hand",
    "field",
    "graveyard",
    "spellTrap",
    "banished",
    "deck",
    "extraDeck",
  ] as const) {
    const cards = player[zone];
    if (Array.isArray(cards) && cards.includes(card)) return zone;
  }
  return null;
}

export function detachSimulatedEquip(
  equipCard: SimulatedCardState | null | undefined,
): void {
  if (!equipCard) return;
  const host = (equipCard.equippedTo || equipCard.equipTarget || null) as
    | SimulatedCardState
    | null;
  if (!host) return;

  if (Array.isArray(host.equips)) {
    host.equips = host.equips.filter((equip) => equip !== equipCard);
  }

  if (
    typeof equipCard.equipAtkBonus === "number" &&
    equipCard.equipAtkBonus !== 0
  ) {
    removeTrackedStatChange(host, "atk", equipCard.equipAtkBonus);
  }
  if (
    typeof equipCard.equipDefBonus === "number" &&
    equipCard.equipDefBonus !== 0
  ) {
    removeTrackedStatChange(host, "def", equipCard.equipDefBonus);
  }
  refreshEquipExtraAttackBonus(equipCard, host, false);
  if (equipCard.grantsBattleIndestructible) {
    host.battleIndestructible = false;
  }

  equipCard.equippedTo = null;
  equipCard.equipTarget = null;
  equipCard.equipAtkBonus = 0;
  equipCard.equipDefBonus = 0;
  equipCard.equipExtraAttacks = 0;
  equipCard.grantsBattleIndestructible = false;
  equipCard.grantsCrescentShieldGuard = false;
}

export function removeCardFromZones(
  player: SimulatedPlayerState | null | undefined,
  card: SimulatedCardState | null | undefined,
): boolean {
  if (!player || !card) return false;
  detachSimulatedEquip(card);
  if (Array.isArray(card.equips) && card.equips.length > 0) {
    card.equips.forEach((equip) => {
      if (!equip) return;
      equip.equippedTo = null;
      equip.equipTarget = null;
    });
  }
  const zones = [
    "hand",
    "field",
    "graveyard",
    "spellTrap",
    "banished",
    "deck",
    "extraDeck",
  ] as const;
  for (const zone of zones) {
    const list = player[zone];
    if (!Array.isArray(list)) continue;
    const idx = list.indexOf(card);
    if (idx !== -1) {
      list.splice(idx, 1);
      clearSimulatedFieldPosition(card);
      return true;
    }
  }
  if (player.fieldSpell === card) {
    player.fieldSpell = null;
    clearSimulatedFieldPosition(card);
    return true;
  }
  return false;
}

export function attachSimulatedEquip(
  equipCard: SimulatedCardState | null | undefined,
  target: SimulatedCardState | null | undefined,
  action: SimulatedEquipAction = {},
): boolean {
  if (!equipCard || !target || target.cardKind !== "monster" || target.isFacedown) {
    return false;
  }

  detachSimulatedEquip(equipCard);
  equipCard.equippedTo = target;
  equipCard.equipTarget = target;
  if (!Array.isArray(target.equips)) target.equips = [];
  if (!target.equips.includes(equipCard)) target.equips.push(equipCard);

  if (Number.isFinite(action.atkBonus as number)) {
    equipCard.equipAtkBonus = action.atkBonus!;
    target.atk = (target.atk || 0) + action.atkBonus!;
  }
  if (Number.isFinite(action.defBonus as number)) {
    equipCard.equipDefBonus = action.defBonus!;
    target.def = (target.def || 0) + action.defBonus!;
  }
  if (Number.isFinite(action.extraAttacks as number) && action.extraAttacks !== 0) {
    equipCard.equipExtraAttacksApplied = 0;
    equipCard.equipExtraAttacks = action.extraAttacks!;
    refreshEquipExtraAttackBonus(equipCard, target, equipCard.effectsNegated !== true);
  }
  if (action.battleIndestructible) {
    equipCard.grantsBattleIndestructible = true;
    target.battleIndestructible = true;
  } else {
    equipCard.grantsBattleIndestructible = false;
  }
  equipCard.grantsCrescentShieldGuard = action.grantCrescentShieldGuard === true;
  return true;
}

export interface SimulatedMoveOptions {
  requireDestination?: boolean;
  state?: Pick<AiStateShape, "bot" | "player">;
  movedByEffect?: boolean;
  sourceCard?: SimulatedCardState | null;
  sourcePlayer?: SimulatedPlayerState | null;
  allowExtraDeckMonsterToHand?: boolean;
}

interface ReadMoveOptions {
  requireDestination?: boolean;
  state?: Pick<AiStateInput, "bot" | "player">;
  movedByEffect?: boolean;
  sourceCard?: AiCardInput | null;
  sourcePlayer?: AiPlayerInput | null;
  allowExtraDeckMonsterToHand?: boolean;
}

function isSimulatedZone(zone: string): zone is SimulatedZone {
  return zone === "hand" || zone === "field" || zone === "graveyard" ||
    zone === "spellTrap" || zone === "banished" || zone === "deck" ||
    zone === "extraDeck" || zone === "fieldSpell";
}

function isSimulatedBanishProtected(
  card: AiCardInput,
  owner: AiPlayerInput,
  fromZone: SimulatedZone,
  options: ReadMoveOptions,
): boolean {
  const players = options.state ? [options.state.player, options.state.bot] : [owner];
  for (const sourceOwner of players) {
    if (!sourceOwner) continue;
    const sources = [...(sourceOwner.field || []), ...(sourceOwner.spellTrap || []),
      ...(sourceOwner.fieldSpell ? [sourceOwner.fieldSpell] : [])];
    for (const source of sources) {
      if (source.isFacedown || source.effectsNegated) continue;
      for (const effect of source.effects || []) {
        if (effect.timing !== "passive" || !("passive" in effect)) continue;
        const passive = effect.passive;
        if (passive?.type !== "banish_protection") continue;
        if (effect.requireZone && effect.requireZone !== findCardZone(sourceOwner, source)) continue;
        const scope = passive.targetScope;
        const ownerRule = scope?.owner || passive.targetOwner || "self";
        if ((ownerRule === "self" && sourceOwner !== owner) ||
            (ownerRule === "opponent" && sourceOwner === owner)) continue;
        const zones = scope?.zones || (scope?.zone ? [scope.zone] : ["field"]);
        if (!zones.includes(fromZone)) continue;
        if (scope?.excludeSelf && source === card) continue;
        if (scope?.requireFaceup && card.isFacedown) continue;
        if (passive.protectFrom === "opponent_effects") {
          const effectOwner = options.sourcePlayer || players.find(candidate => findCardZone(candidate, options.sourceCard));
          if ((!options.movedByEffect && !options.sourceCard) || !effectOwner || effectOwner === owner) continue;
        }
        const filters = { ...(scope?.filters || passive.filters || {}),
          ...(passive.archetype ? { archetype: passive.archetype } : {}),
          ...(passive.cardKind ? { cardKind: passive.cardKind } : {}) };
        if (!cardMatchesFilter(card, filters)) continue;
        return true;
      }
    }
  }
  return false;
}

function resolveSimulatedMove(
  player: AiPlayerInput | null | undefined,
  card: AiCardInput | null | undefined,
  requestedZone: string,
  sourcePlayer: AiPlayerInput | null | undefined,
  options: ReadMoveOptions,
): { fromZone: SimulatedZone | null; toZone: SimulatedZone | "removed" } | null {
  if (!player || !sourcePlayer || !card || !isSimulatedZone(requestedZone)) return null;
  const fromZone = findCardZone(sourcePlayer, card);
  let toZone: SimulatedZone | "removed" = requestedZone;
  if (toZone === fromZone && player === sourcePlayer) return { fromZone, toZone };
  if (toZone === "graveyard" && !card.isToken && options.state) {
    const destination = getSendToGraveReplacementDestination(card, sourcePlayer, [options.state.player, options.state.bot]);
    if (destination && isSimulatedZone(destination)) toZone = destination;
  }
  if (fromZone === "field" && toZone !== "field" && card.banishWhenLeavesField && !card.isToken) {
    toZone = "banished";
  }
  if (toZone === "banished" && fromZone && isSimulatedBanishProtected(card, sourcePlayer, fromZone, options)) return null;
  if (fromZone === "field" && toZone !== "field" && card.isToken) toZone = "removed";
  const extraMonster = card.monsterType === "fusion" || card.monsterType === "ascension" || card.monsterType === "synchro";
  if (extraMonster && (toZone === "deck" || (toZone === "hand" && !options.allowExtraDeckMonsterToHand))) toZone = "extraDeck";
  if (options.requireDestination && toZone !== requestedZone) return null;
  if ((toZone === "field" || toZone === "spellTrap") && getAvailableFieldSlots(player[toZone] || []).length === 0) return null;
  return { fromZone, toZone };
}

/** Read-only preflight; a rejected departure must not consume materials or statuses. */
export function canMoveCardToZone(
  player: AiPlayerInput | null | undefined,
  card: AiCardInput | null | undefined,
  zone: string,
  sourcePlayer: AiPlayerInput | null | undefined = player,
  options: ReadMoveOptions = {},
): boolean {
  return resolveSimulatedMove(player, card, zone, sourcePlayer, options) !== null;
}

export function moveCardToZone(
  player: SimulatedPlayerState | null | undefined,
  card: SimulatedCardState | null | undefined,
  zone: string,
  sourcePlayer: SimulatedPlayerState | null | undefined = player,
  options: SimulatedMoveOptions = {},
): boolean {
  if (!player || !sourcePlayer || !card) return false;
  const move = resolveSimulatedMove(player, card, zone, sourcePlayer, options);
  if (!move) return false;
  const { fromZone, toZone } = move;
  if (toZone === fromZone && player === sourcePlayer) return true;
  if ((fromZone === "field" || fromZone === "spellTrap" || fromZone === "fieldSpell") &&
      toZone !== "field" && toZone !== "spellTrap" && toZone !== "fieldSpell") {
    const field = options.state ? [...options.state.player.field, ...options.state.bot.field] : sourcePlayer.field;
    removeFieldAuraBuffContributions(card, field, field.indexOf(card));
  }
  if (fromZone === "field" && toZone !== "field") {
    card.protectionEffects = (card.protectionEffects || []).filter(
      entry => entry.removeOnLeave === false && entry.duration !== "while_faceup",
    );
    delete card.oncePerTurnUsageByName;
    card.oncePerTurnResetVersion = (card.oncePerTurnResetVersion || 0) + 1;
    delete card.banishWhenLeavesField;
    card.battlePositionLocked = false;
    restoreFieldExitStatuses(card);
    restoreTemporaryStatuses(card);
    if (card.cardKind === "monster") {
      card.summonedTurn = null;
      card.setTurn = null;
      card.positionChangedThisTurn = false;
      card.cannotAttackThisTurn = false;
      card.cannotAttackUntilTurn = null;
      card.immuneToOpponentEffectsUntilTurn = null;
      delete card.attackLimitThisTurn;
      delete card.attackLimitDuration;
      if (card.tempAtkBoost) { removeTrackedStatChange(card, "atk", card.tempAtkBoost); card.tempAtkBoost = 0; }
      if (card.tempDefBoost) { removeTrackedStatChange(card, "def", card.tempDefBoost); card.tempDefBoost = 0; }
      if (card.originalAtk != null) { card.atk = card.originalAtk; card.originalAtk = null; }
      if (card.originalDef != null) { card.def = card.originalDef; card.originalDef = null; }
      if (card.originalLevel != null) { card.level = card.originalLevel; card.originalLevel = null; }
      for (const buff of card.turnBasedBuffs || []) {
        if (buff.stat === "atk") removeTrackedStatChange(card, "atk", buff.value);
        if (buff.stat === "def") removeTrackedStatChange(card, "def", buff.value);
      }
      card.turnBasedBuffs = [];
      clearPermanentStatBuffs(card);
      card.effectsNegated = false;
      card.effectsNegatedDuration = null;
    }
  }
  if ((fromZone === "spellTrap" || fromZone === "fieldSpell") &&
      toZone !== "field" && toZone !== "spellTrap" && toZone !== "fieldSpell") {
    card.effectsNegated = false;
    card.effectsNegatedDuration = null;
  }
  if (
    card.cardKind === "monster" &&
    Array.isArray(card.equips) &&
    card.equips.length > 0 &&
    toZone !== "field"
  ) {
    const attachedEquips = card.equips.slice();
    card.equips = [];
    attachedEquips.forEach((equip) => {
      if (!equip) return;
      detachSimulatedEquip(equip);
      removeCardFromZones(sourcePlayer, equip);
      if (!Array.isArray(player.graveyard)) player.graveyard = [];
      appendSimulatedZoneCard(player.graveyard, equip);
    });
  }
  removeCardFromZones(sourcePlayer, card);
  if (toZone !== "field" && toZone !== "spellTrap") card.locationVersion = (card.locationVersion || 0) + 1;
  card.location = toZone === "removed" ? null : toZone;
  if (toZone === "removed") return true;
  if (toZone === "graveyard" || toZone === "banished") card.isFacedown = false;
  if (toZone === "extraDeck") {
    card.properSummonEstablished = false;
    card.properSummonProcedure = null;
  }
  if (toZone === "fieldSpell") {
    player.fieldSpell = card;
    return true;
  }
  player[toZone] ||= [];
  if (toZone === "field" || toZone === "spellTrap") return appendSimulatedFieldCard(player[toZone], card);
  appendSimulatedZoneCard(player[toZone], card);
  return true;
}

export function findCardOwner(
  state: Pick<AiStateShape, "bot" | "player"> | null | undefined,
  card: SimulatedCardState | null | undefined,
): SimulatedPlayerState | null {
  if (!state || !card) return null;
  const players = [state.bot, state.player];
  for (const player of players) {
    if (!player) continue;
    if (player.fieldSpell === card) return player;
    if (Array.isArray(player.field) && player.field.includes(card)) {
      return player;
    }
    if (Array.isArray(player.hand) && player.hand.includes(card)) return player;
    if (Array.isArray(player.graveyard) && player.graveyard.includes(card)) {
      return player;
    }
    if (Array.isArray(player.spellTrap) && player.spellTrap.includes(card)) {
      return player;
    }
    if (Array.isArray(player.deck) && player.deck.includes(card)) return player;
    if (Array.isArray(player.banished) && player.banished.includes(card)) {
      return player;
    }
    if (Array.isArray(player.extraDeck) && player.extraDeck.includes(card)) return player;
  }
  return null;
}
