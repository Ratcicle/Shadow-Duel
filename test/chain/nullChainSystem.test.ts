import assert from "node:assert/strict";
import test from "node:test";

import NullChainSystem from "../../src/core/NullChainSystem.js";
import type {
  ChainEffectTarget,
  ChainPlayer,
} from "../../src/core/contracts/chainRuntime.js";
import { createRuntimeGame, placeFieldCards, runtimeCard } from "../helpers/game.js";

interface SelectionCandidate {
  key: string;
  cardRef: object;
}

interface SelectionRequirement {
  id: string;
  min: number;
  max: number;
  candidates: SelectionCandidate[];
}

interface SelectionContractFixture {
  requirements: SelectionRequirement[];
  kind?: string;
  timing?: string;
  purpose?: string;
  ui?: {
    allowCancel?: boolean;
    preventCancel?: boolean;
  };
}

interface SelectionSessionFixture {
  selectionContract: SelectionContractFixture;
  execute(selections: { target: string[] }): unknown;
}

function selectionFixture() {
  const target = { id: 901, name: "Selection target" };
  const contract: SelectionContractFixture = {
    requirements: [
      {
        id: "target",
        min: 1,
        max: 1,
        candidates: [{ key: "target-key", cardRef: target }],
      },
    ],
  };
  return { target, contract };
}

function createNullChainSystem(game: object): NullChainSystem {
  return Reflect.construct(NullChainSystem, [game]) as NullChainSystem;
}

function createPlayer(
  id: string,
  name: string,
  controllerType: string,
): ChainPlayer {
  return {
    id,
    name,
    controllerType,
    lp: 8000,
    deck: [],
    extraDeck: [],
    hand: [],
    field: [],
    spellTrap: [],
    graveyard: [],
    banished: [],
    fieldSpell: null,
  };
}

test("NullChainSystem resolves a human activation selection", async () => {
  const { target, contract } = selectionFixture();
  const player = createPlayer("player", "Player", "human");
  const observedSessions: SelectionSessionFixture[] = [];
  const game = {
    effectEngine: {
      resolveTargets(definitions: readonly ChainEffectTarget[]) {
        if (definitions.length === 0) return { ok: true, targets: {} };
        return {
          ok: true,
          needsSelection: true,
          targets: {},
          selectionContract: contract,
        };
      },
    },
    getOpponent() {
      return null;
    },
    startTargetSelectionSession(session: SelectionSessionFixture) {
      observedSessions.push(session);
      return session.execute({ target: ["target-key"] });
    },
  };
  const chain = createNullChainSystem(game);

  const selections = await chain.getPlayerSelectionsForDefinitions(
    { id: 900, name: "Source" },
    [{ id: "target" }],
    player,
    { type: "card_activation" },
  );

  assert.deepEqual(selections, { target: [target] });
  assert.equal(observedSessions.length, 1);
  const [observedSession] = observedSessions;
  assert.ok(observedSession);
  assert.equal(observedSession.selectionContract.kind, "target");
  assert.equal(observedSession.selectionContract.timing, "activation");
  assert.deepEqual(observedSession.selectionContract.ui, {
    allowCancel: true,
    preventCancel: false,
  });
});

test("NullChainSystem resolves the same activation selection for AI", async () => {
  const { target, contract } = selectionFixture();
  const player = createPlayer("bot", "Bot", "ai");
  let humanSessionOpened = false;
  const game = {
    effectEngine: {
      resolveTargets(definitions: readonly ChainEffectTarget[]) {
        if (definitions.length === 0) return { ok: true, targets: {} };
        return {
          ok: true,
          needsSelection: true,
          targets: {},
          selectionContract: contract,
        };
      },
    },
    autoSelector: {
      select() {
        return {
          ok: true,
          selections: { target: ["target-key"] },
        };
      },
    },
    getOpponent() {
      return null;
    },
    startTargetSelectionSession() {
      humanSessionOpened = true;
      throw new Error("AI must not open a human selection session");
    },
  };
  const chain = createNullChainSystem(game);

  const selections = await chain.getPlayerSelectionsForDefinitions(
    { id: 900, name: "Source" },
    [{ id: "target" }],
    player,
    { type: "card_activation" },
  );

  assert.deepEqual(selections, { target: [target] });
  assert.equal(humanSessionOpened, false);
});

test("NullChainSystem resolves AI selections with the real EffectEngine and AutoSelector", async (t) => {
  const game = createRuntimeGame({ disableChains: true });
  t.after(() => game.dispose());
  game.bot.controllerType = "ai";
  const source = runtimeCard({ id: 900, name: "Source" }, game.bot.id);
  const candidates = [901, 902].map((id) => runtimeCard({
    id,
    name: `Selection target ${id}`,
    cardKind: "monster",
    atk: 1000,
    def: 1000,
    level: 4,
  }, game.bot.id));
  placeFieldCards(game.bot.field, ...candidates);
  const autoSelect = t.mock.method(game.autoSelector, "select");
  t.mock.method(game, "startTargetSelectionSession", () => {
    assert.fail("AI must not open a human selection session");
  });

  // No provided definitions or prior action targets require no further choice.
  assert.deepEqual(
    game.effectEngine.resolveTargets([], { source, player: game.bot }, null),
    { ok: true, targets: {} },
  );
  const selections = await game.chainSystem.getPlayerSelectionsForDefinitions(
    source,
    [{ id: "target", owner: "self", zone: "field", cardKind: "monster", count: { min: 1, max: 1 } }],
    game.bot,
    { type: "card_activation" },
  );

  assert.equal(autoSelect.mock.callCount(), 1);
  assert.ok(selections);
  const selected: unknown = Reflect.get(selections, "target");
  assert.ok(Array.isArray(selected));
  assert.equal(selected.length, 1);
  assert.ok(candidates.some((candidate) => candidate === selected[0]));
});

test("NullChainSystem preserves auto-resolved targets without a session", async () => {
  const target = { id: 901, name: "Context target" };
  const player = createPlayer("player", "Player", "human");
  const game = {
    effectEngine: {
      resolveTargets() {
        return {
          ok: true,
          needsSelection: false,
          targets: { target: [target] },
        };
      },
    },
    getOpponent() {
      return null;
    },
  };
  const chain = createNullChainSystem(game);

  const selections = await chain.getPlayerSelectionsForDefinitions(
    { id: 900, name: "Source" },
    [{ id: "target" }],
    player,
    { type: "card_activation" },
  );

  assert.deepEqual(selections, { target: [target] });
});

test("NullChainSystem preserves legacy opponent delegation for null", () => {
  const sentinel = { id: "opponent", name: "Opponent" };
  const observed: unknown[] = [];
  const chain = createNullChainSystem({
    getOpponent(player: unknown) {
      observed.push(player);
      return sentinel;
    },
  });

  assert.equal(chain.getOpponent(null), sentinel);
  assert.deepEqual(observed, [null]);
});
