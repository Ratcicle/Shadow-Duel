import { resolveExactInstanceSelection } from "../../AutoSelector.js";
import type { EventCardPresenceSnapshot, EventZone } from "../../contracts/events.js";
import { captureEventCardPresence, matchesEventCardPresence, type PresenceCard } from "../../game/zones/ownership.js";

// Private, enumerable metadata survives action decorators/spreads without
// changing AIAction or its serialized shape. Snapshots contain no live links.
const actionPresence = Symbol("planning action presence");
interface ActionPresence {
  readonly source: EventCardPresenceSnapshot;
  readonly materials: readonly EventCardPresenceSnapshot[];
}

export function getPlanningActionPresence(target: object): ActionPresence | undefined {
  return Reflect.get(target, actionPresence) as ActionPresence | undefined;
}

/** Establish a runtime ID before capturing a generated command, when available. */
function establishDuelIdentity(game: object | null | undefined, card: PresenceCard): void {
  if (!game || card.duelCardId != null) return;
  const ensure: unknown = Reflect.get(game, "ensureDuelCardId");
  if (typeof ensure === "function") Reflect.apply(ensure, game, [card]);
}

/** A runtime Player owns its Game; projected players cannot reach it here. */
export function getPlanningIdentityGame(player: object, supplied?: object | null): object | undefined {
  if (supplied) return supplied;
  const game: unknown = Reflect.get(player, "game");
  if (!game || typeof game !== "object") return undefined;
  return Reflect.get(game, "bot") === player || Reflect.get(game, "player") === player ? game : undefined;
}

export function bindPlanningActionPresence<T extends object>(
  action: T, source: PresenceCard, controllerId: string, zone: EventZone,
  game?: object | null,
  materials: readonly { readonly card: PresenceCard; readonly zone: EventZone }[] = [],
): T {
  // Legacy projections without physical identity retain their historical hints.
  if (!controllerId || (source.instanceId ?? source._instanceId) == null) return action;
  establishDuelIdentity(game, source);
  for (const material of materials) establishDuelIdentity(game, material.card);
  const presence: ActionPresence = Object.freeze({
    source: captureEventCardPresence(source, controllerId, zone),
    materials: Object.freeze(materials.map(material =>
      captureEventCardPresence(material.card, controllerId, material.zone))),
  });
  Object.defineProperty(action, actionPresence, { value: presence, enumerable: true, configurable: true });
  return action;
}

export function copyPlanningActionPresence(source: object, target: object): void {
  const presence = getPlanningActionPresence(source);
  if (presence) Object.defineProperty(target, actionPresence, { value: presence, enumerable: true, configurable: true });
}

interface PresencePlayer {
  readonly id?: string | undefined;
  readonly hand?: readonly PresenceCard[];
  readonly field?: readonly PresenceCard[];
  readonly spellTrap?: readonly PresenceCard[];
  readonly deck?: readonly PresenceCard[];
  readonly extraDeck?: readonly PresenceCard[];
  readonly graveyard?: readonly PresenceCard[];
  readonly banished?: readonly PresenceCard[];
  readonly fieldSpell?: PresenceCard | null | undefined;
}

/** Validate every captured presence before any cost or strategy callback. */
export function isPlanningActionPresenceCurrent(action: object, player: PresencePlayer): boolean {
  const binding = getPlanningActionPresence(action);
  if (!binding) return true;
  return [binding.source, ...binding.materials].every(snapshot => {
    if (snapshot.controllerId !== player.id) return false;
    let cards: readonly PresenceCard[] | undefined;
    switch (snapshot.zone) {
      case "fieldSpell": cards = player.fieldSpell ? [player.fieldSpell] : []; break;
      case "hand": case "field": case "spellTrap": case "deck":
      case "extraDeck": case "graveyard": case "banished": cards = player[snapshot.zone]; break;
      default: return false;
    }
    return !!cards && resolvePlanningCard(cards, undefined, player.id || "", snapshot.zone,
      action, snapshot === binding.source ? undefined : binding.materials.indexOf(snapshot)).card !== undefined;
  });
}

/** Explicit physical references are authoritative; an absent one never falls back. */
export function resolvePlanningCard<Card extends PresenceCard>(
  candidates: readonly Card[], hint: PresenceCard | null | undefined,
  controllerId: string, zone: EventZone, target?: object,
  materialOffset?: number,
): { readonly explicit: boolean; readonly card: Card | undefined } {
  const binding = target && getPlanningActionPresence(target);
  const snapshot = materialOffset === undefined ? binding?.source : binding?.materials[materialOffset];
  const instanceId = snapshot?.instanceId ?? hint?.instanceId ?? hint?._instanceId;
  if (instanceId == null) return { explicit: !!snapshot, card: undefined };
  const physical = candidates.flatMap(card => {
    const id = card.instanceId ?? card._instanceId;
    return id == null ? [] : [{ instanceId: id, card }];
  });
  const card = resolveExactInstanceSelection(physical, [instanceId], { min: 1, max: 1 })?.[0]?.card;
  const presence = snapshot || (hint?.id != null ? captureEventCardPresence(hint, controllerId, zone) : undefined);
  return { explicit: true, card: card && (!presence ||
    matchesEventCardPresence(card, presence, controllerId, zone)) ? card : undefined };
}

/** null preserves a legacy caller's precedence; -1 is an explicit failed binding. */
export function resolvePlanningSourceIndex<Card extends PresenceCard>(
  candidates: readonly Card[], action: object, controllerId: string,
  zone: EventZone, hint?: PresenceCard | null,
): number | null {
  const resolved = resolvePlanningCard(candidates, hint, controllerId, zone, action);
  return resolved.explicit ? (resolved.card ? candidates.indexOf(resolved.card) : -1) : null;
}

/** Legacy material aliases remain accepted, but explicit misses are terminal. */
export function resolvePlanningMaterialIds<Card extends PresenceCard>(
  candidates: readonly Card[], ids: readonly (string | number)[],
): Card | undefined {
  if (!ids.length) return undefined;
  const matching = candidates.filter(card => ["instanceId", "_instanceId", "uid", "uuid", "simInstanceId", "fieldPresenceId"]
    .some(key => ids.includes(Reflect.get(card, key) as string | number)));
  if (matching.length !== 1) return undefined;
  const instanceId = matching[0]?.instanceId ?? matching[0]?._instanceId;
  if (instanceId == null) return undefined;
  const physical = candidates.flatMap(card => {
    const id = card.instanceId ?? card._instanceId;
    return id == null ? [] : [{ instanceId: id, card }];
  });
  return resolveExactInstanceSelection(physical, [instanceId], { min: 1, max: 1 })?.[0]?.card;
}
