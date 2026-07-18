function hashSeed(value) {
  if (Number.isFinite(Number(value))) return Number(value) >>> 0;
  const text = String(value ?? "shadow-duel");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export class DeterministicRandom {
  constructor(seed) {
    this.seed = hashSeed(seed);
    this.state = this.seed;
    this.calls = 0;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    this.calls += 1;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  shuffle(items) {
    if (!Array.isArray(items)) return items;
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  snapshot() {
    return { seed: this.seed, state: this.state, calls: this.calls };
  }

  restore(snapshot = {}) {
    if (!Number.isFinite(Number(snapshot.state))) {
      throw new TypeError("Invalid deterministic RNG snapshot.");
    }
    this.seed = hashSeed(snapshot.seed ?? this.seed);
    this.state = Number(snapshot.state) >>> 0;
    this.calls = Math.max(0, Number(snapshot.calls || 0));
    return this.snapshot();
  }
}

export function createDeterministicRandom(seed) {
  return new DeterministicRandom(seed);
}

