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

/** Drive explicit human selections while the real broker owns the pending action. */
export async function completeTestSelections(game: RuntimeGame, action: Promise<unknown>): Promise<void> {
  let done = false;
  let failure: unknown;
  const completion = action.then(() => { done = true; }, error => { failure = error; done = true; });
  const resolutions = new Set<Promise<void>>();
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session) {
      for (const requirement of session.requirements) {
        session.selections[requirement.id] = requirement.candidates.slice(0, requirement.min).map(card => card.key);
      }
      // Resolving one choice can wait for a second choice from an on-summon
      // trigger. Keep driving that session while the first callback is pending.
      const resolution = game.finishTargetSelection();
      resolutions.add(resolution);
      void resolution.then(() => resolutions.delete(resolution), error => {
        failure = error;
        resolutions.delete(resolution);
      });
    }
    if (done && !game.targetSelection && resolutions.size === 0) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done, "the action must finish with all human selections consumed");
  assert.equal(game.targetSelection, null, "all human choices must be submitted");
  assert.equal(resolutions.size, 0, "all selection callbacks must finish");
  await completion;
  if (failure) throw failure;
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
