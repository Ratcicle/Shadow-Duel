import assert from "node:assert/strict";
import Card from "../../src/core/Card.js";
import ChainSystem from "../../src/core/ChainSystem.js";
import EffectEngine from "../../src/core/EffectEngine.js";
import Game from "../../src/core/Game.js";
import Player from "../../src/core/Player.js";
import type { ActionRuntimePlayer } from "../../src/core/contracts/actionRuntime.js";
import type {
  CardConstructorData,
  GameCard,
} from "../../src/core/contracts/cards.js";
import type { GameOptions } from "../../src/core/contracts/game.js";
import type { FieldSlot } from "../../src/core/contracts/placement.js";
import { assignAutomaticFieldSlot, getAvailableFieldSlots } from "../../src/core/game/zones/placement.js";
import { unsafeFixture } from "./fixtures.js";

/** Explicit fixture entry boundary; never normalizes live runtime state. */
export function placeFieldCards<Card extends { fieldSlot?: FieldSlot | null }>(
  row: Card[],
  ...cards: Card[]
): number {
  for (const card of cards) {
    if (card.fieldSlot == null) assert.notEqual(assignAutomaticFieldSlot(card, row), null);
    else assert.ok(getAvailableFieldSlots(row).includes(card.fieldSlot));
    row.push(card);
  }
  return row.length;
}

// Methods installed by the manifest are called on this verified concrete
// instance; their standalone host parameter belongs to module-level tests.
type RuntimeEffectEngine = {
  -readonly [Key in keyof EffectEngine]: OmitThisParameter<EffectEngine[Key]>;
};

// Player's public strategy view exposes Chain capabilities. Integration tests
// also read the optional action-selection capabilities of the same strategy.
type RuntimePlayer = Player &
  ActionRuntimePlayer & { oncePerDuelUsageByName?: Record<string, number> };
export type RuntimeGame = Omit<Game, "player" | "bot" | "effectEngine"> & {
  player: RuntimePlayer;
  bot: RuntimePlayer;
  effectEngine: RuntimeEffectEngine;
};

/** Integration tests exercise the concrete modules behind Game's public ports. */
export function createRuntimeGame(
  options?: GameOptions & { disableChains?: false },
): RuntimeGame & { chainSystem: ChainSystem };
export function createRuntimeGame(options: GameOptions): RuntimeGame;
export function createRuntimeGame(options: GameOptions = {}): RuntimeGame {
  const game = new Game(options);
  const { player, bot, effectEngine } = game;
  assert.ok(player instanceof Player);
  assert.ok(bot instanceof Player);
  for (const owner of [player, bot]) {
    assert.ok(
      Object.values(owner.oncePerDuelUsageByName ?? {}).every(
        (value) => typeof value === "number",
      ),
    );
  }
  assert.ok(effectEngine instanceof EffectEngine);
  if (!options.disableChains)
    assert.ok(game.chainSystem instanceof ChainSystem);
  const engine: RuntimeEffectEngine = effectEngine;
  return Object.assign(game, {
    player: player as RuntimePlayer,
    bot: bot as RuntimePlayer,
    effectEngine: engine,
  });
}

export function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

type RuntimeCardInput = Partial<CardConstructorData> &
  Partial<Omit<GameCard, keyof CardConstructorData | "instanceId">> & {
    instanceId?: string | number;
  };

/** Complete model for unit fixtures while retaining their historical IDs. */
export function runtimeCard(input: RuntimeCardInput, owner = "player"): Card {
  const { instanceId, ...fields } = input;
  const card = new Card(
    { ...fields, name: fields.name ?? "Fixture card" },
    owner,
  );
  Object.assign(card, fields);
  if (instanceId !== undefined)
    card.instanceId =
      typeof instanceId === "number"
        ? instanceId
        : unsafeFixture<number>(
            instanceId,
            "Unit fixtures use readable string instance IDs to distinguish cards.",
          );
  return card;
}
