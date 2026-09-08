import { restoreFieldExitStatuses } from "../../Card.js";
import type {
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

interface SimulatedEquipAction {
  atkBonus?: number;
  defBonus?: number;
  extraAttacks?: number;
  battleIndestructible?: boolean;
  grantCrescentShieldGuard?: boolean;
}

type SimulatedZonePlayer = SimulatedPlayerState & {
  [Zone in SimulatedArrayZone]: SimulatedCardState[];
};

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
    default:
      return [];
  }
}

export function findCardZone(
  player: SimulatedPlayerState | null | undefined,
  card: SimulatedCardState | null | undefined,
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
    host.atk = Math.max(0, (host.atk || 0) - equipCard.equipAtkBonus);
  }
  if (
    typeof equipCard.equipDefBonus === "number" &&
    equipCard.equipDefBonus !== 0
  ) {
    host.def = Math.max(0, (host.def || 0) - equipCard.equipDefBonus);
  }
  if (
    typeof equipCard.equipExtraAttacks === "number" &&
    equipCard.equipExtraAttacks !== 0
  ) {
    host.extraAttacks = Math.max(
      0,
      (host.extraAttacks || 0) - equipCard.equipExtraAttacks,
    );
  }
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
      return true;
    }
  }
  if (player.fieldSpell === card) {
    player.fieldSpell = null;
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
    equipCard.equipExtraAttacks = action.extraAttacks!;
    target.extraAttacks = (target.extraAttacks || 0) + action.extraAttacks!;
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

export function moveCardToZone(
  player: SimulatedPlayerState | null | undefined,
  card: SimulatedCardState | null | undefined,
  zone: string,
): boolean {
  if (!player || !card) return false;
  const fromZone = findCardZone(player, card);
  if (fromZone === "field" && zone !== "field") {
    card.battlePositionLocked = false;
    restoreFieldExitStatuses(card);
  }
  if (
    card.cardKind === "monster" &&
    Array.isArray(card.equips) &&
    card.equips.length > 0 &&
    zone !== "field"
  ) {
    const attachedEquips = card.equips.slice();
    card.equips = [];
    attachedEquips.forEach((equip) => {
      if (!equip) return;
      detachSimulatedEquip(equip);
      removeCardFromZones(player, equip);
      if (!Array.isArray(player.graveyard)) player.graveyard = [];
      player.graveyard.push(equip);
    });
  }
  removeCardFromZones(player, card);
  if (zone === "extraDeck") {
    card.properSummonEstablished = false;
    card.properSummonProcedure = null;
  }
  if (zone === "fieldSpell") {
    player.fieldSpell = card;
    return true;
  }
  (player as SimulatedZonePlayer)[zone as SimulatedArrayZone] ||
    ((player as SimulatedZonePlayer)[zone as SimulatedArrayZone] = []);
  if (
    Array.isArray(
      (player as SimulatedZonePlayer)[zone as SimulatedArrayZone],
    )
  ) {
    (player as SimulatedZonePlayer)[zone as SimulatedArrayZone].push(card);
    return true;
  }
  return false;
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
  }
  return null;
}
