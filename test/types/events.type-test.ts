import type { DuelEventName } from "../../src/core/contracts/effects.js";
import type {
  CollectedTriggerEventName,
  DuelEventMap,
  EventBusHost,
  InformationalEventMap,
  RuntimeEventMap,
} from "../../src/core/contracts/events.js";

declare const bus: EventBusHost;

const player = { id: "player", name: "Player", field: [] };
const bot = { id: "bot", name: "Bot", field: [] };
const card = { id: 1, name: "Card", cardKind: "monster" } as const;

bus.emit("after_summon", {
  card,
  player,
  method: "special",
  fromZone: "hand",
});
bus.notify("position_chosen", {
  card,
  player,
  position: "attack",
  context: "special_summon",
});
bus.on("attack_declared", (payload) => {
  payload.redirectedTarget = card;
  payload.redirectedTargetOwner = bot;
});

// contract-negative: an informational-only event cannot enter trigger resolution
// @ts-expect-error
bus.emit("decision_made", {
  decisionId: 1,
  kind: "choice",
  actorId: "player",
  candidateKeys: [],
  value: {},
  context: {},
});

// contract-negative: a resolvable-only event cannot be sent through notify
// @ts-expect-error
bus.notify("after_summon", {
  card,
  player,
  method: "special",
  fromZone: "hand",
});

// contract-negative: after_summon requires the real summon payload
// @ts-expect-error
bus.emit("after_summon", { winner: player, reason: "lp_zero" });

// contract-negative: event listeners receive the payload tied to their name
// @ts-expect-error
bus.on("lp_change", (payload: DuelEventMap["card_moved"]) => {
  void payload;
});

const declarativeEvent: DuelEventName = "after_summon";
// contract-negative: runtime-only events do not widen the card schema vocabulary
// @ts-expect-error
const runtimeOnlyDeclarativeEvent: DuelEventName = "cards_added_to_hand";

const collectedEvent: CollectedTriggerEventName = "card_flipped";
// contract-negative: emitted events without a specialized collector stay separate
// @ts-expect-error
const eventWithoutCollector: CollectedTriggerEventName = "game_over";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Expect<Value extends true> = Value;

type SharedActivationPayload = Expect<
  Equal<
    DuelEventMap["effect_activated"],
    InformationalEventMap["effect_activated"]
  >
>;
type SharedLpPayload = Expect<
  Equal<DuelEventMap["lp_change"], InformationalEventMap["lp_change"]>
>;
type RuntimeActivationPayload = Expect<
  Equal<
    RuntimeEventMap["effect_activated"],
    DuelEventMap["effect_activated"]
  >
>;

const sharedActivationPayload: SharedActivationPayload = true;
const sharedLpPayload: SharedLpPayload = true;
const runtimeActivationPayload: RuntimeActivationPayload = true;

void declarativeEvent;
void runtimeOnlyDeclarativeEvent;
void collectedEvent;
void eventWithoutCollector;
void sharedActivationPayload;
void sharedLpPayload;
void runtimeActivationPayload;
