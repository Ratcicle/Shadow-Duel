// Headless runtime environment shared by the benchmark runners (harness and
// Tech-Zero ablation), so that their duels see the same Web Storage. No
// engine imports: the worker installs it before loading the engine.

/** A Storage backed by a Map: keys in insertion order, values coerced to strings. */
function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: key => { values.delete(key); },
    clear: () => { values.clear(); },
  };
}

/**
 * Installs an empty memory storage when the runtime has none and returns the
 * function that restores the previous global property (a no-op otherwise).
 */
export function installMemoryStorage(): () => void {
  if (typeof globalThis.localStorage !== "undefined") return () => {};
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: createMemoryStorage() });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}
