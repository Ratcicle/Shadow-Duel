import test from "node:test";
import assert from "node:assert/strict";

import {
  hashCanonicalValue,
  serializeReplayEventPayload,
  stableStringify,
} from "../../src/core/game/replay/canonical.js";
import type { CanonicalReplayGamePort } from "../../src/core/contracts/replay.js";

const serializationGame: CanonicalReplayGamePort = {
  ensureDuelCardId(card) {
    return card.duelCardId ?? null;
  },
};

test("normalizador preserva os goldens FNV-1a legados", () => {
  const specialValues = {
    z: 1,
    a: { d: 4, c: 3 },
    arr: [3, undefined, Number.NaN, Infinity, -Infinity],
  };
  assert.equal(
    stableStringify(specialValues),
    '{"a":{"c":3,"d":4},"arr":[3,null,null,null,null],"z":1}',
  );
  assert.equal(hashCanonicalValue(specialValues), "dd26f237");

  const mapAndSet = {
    map: new Map([["b", 2], ["a", 1]]),
    set: new Set(["z", "a"]),
  };
  assert.equal(
    stableStringify(mapAndSet),
    '{"map":[["a",1],["b",2]],"set":["a","z"]}',
  );
  assert.equal(hashCanonicalValue(mapAndSet), "67b31432");

  const omitted = {
    fn() {
      return true;
    },
    sym: Symbol("x"),
    undef: undefined,
  };
  assert.equal(stableStringify(omitted), "{}");
  assert.equal(hashCanonicalValue(omitted), "5465b825");
});

test("arrays preservam ordem, buracos e valores não serializáveis como null", () => {
  const sparse: unknown[] = [];
  sparse.length = 5;
  sparse[1] = undefined;
  sparse[2] = () => true;
  sparse[3] = Symbol("ignored");
  sparse[4] = 7n;

  assert.equal(stableStringify(sparse), '[null,null,null,null,"7"]');
});

test("arrays esparsos ignoram valores numéricos herdados", () => {
  const sparse: unknown[] = [];
  sparse.length = 1;
  const inheritedIndex = Object.create(Array.prototype) as unknown[];
  inheritedIndex[0] = "inherited";
  Object.setPrototypeOf(sparse, inheritedIndex);

  assert.equal(stableStringify(sparse), "[null]");
});

test("ciclos de array, Map e Set usam identidade mínima ou null", () => {
  const array: unknown[] = [];
  array.push(array);

  const map = new Map<string, unknown>();
  map.set("self", map);

  const set = new Set<unknown>();
  set.add(set);

  const identified: { id: number; self?: unknown } = { id: 42 };
  identified.self = identified;

  assert.equal(stableStringify(array), "[null]");
  assert.equal(stableStringify(map), '[["self",null]]');
  assert.equal(stableStringify(set), "[null]");
  assert.equal(stableStringify(identified), '{"id":42,"self":{"id":42}}');
});

test("Sets de objetos são ordenados pelo JSON canônico com desempate estável", () => {
  const first = { z: 1, a: 2 };
  const second = { a: 1 };
  const equivalent = { a: 1 };
  const set = new Set([first, second, equivalent]);

  assert.equal(
    stableStringify(set),
    '[{"a":1},{"a":1},{"a":2,"z":1}]',
  );
});

test("ordenação usa code units e não depende de localeCompare", () => {
  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = function forbiddenLocaleCompare(): number {
    throw new Error("localeCompare must not be used");
  };
  try {
    assert.equal(
      stableStringify({ ä: 1, Z: 2, a: 3, A: 4 }),
      '{"A":4,"Z":2,"a":3,"ä":1}',
    );
    assert.equal(
      stableStringify(new Map([["ä", 1], ["Z", 2], ["a", 3], ["A", 4]])),
      '[["A",4],["Z",2],["a",3],["ä",1]]',
    );
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
});

test("referências repetidas não são tratadas como ciclos", () => {
  const shared = { nested: { value: 3 } };
  assert.equal(
    stableStringify({ first: shared, second: shared }),
    '{"first":{"nested":{"value":3}},"second":{"nested":{"value":3}}}',
  );
});

test("instâncias usam somente propriedades próprias enumeráveis", () => {
  class Example {
    own = 1;

    method(): number {
      return 2;
    }
  }
  Object.defineProperty(Example.prototype, "enumerablePrototypeValue", {
    value: 3,
    enumerable: true,
  });
  const value = new Example();
  Object.defineProperty(value, "hidden", { value: 4, enumerable: false });

  assert.equal(stableStringify(value), '{"own":1}');
});

test("payload de evento projeta Card e Player antes da normalização permissiva", () => {
  const card = {
    duelCardId: 77,
    id: 9,
    cardKind: "monster",
    name: "Projected",
    locationVersion: 4,
    ignored: () => true,
  };
  const payload = {
    card,
    owner: { id: "player", ui: Symbol("ignored") },
    unsupported: undefined,
    nested: [Number.NaN, () => true],
  };

  assert.deepEqual(serializeReplayEventPayload(serializationGame, payload), {
    card: { cardId: 9, duelCardId: 77, locationVersion: 4 },
    nested: [null, null],
    owner: { playerId: "player" },
  });
});
