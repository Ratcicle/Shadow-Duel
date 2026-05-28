export function getCounterCount(card, counterType = "judgment_marker") {
  if (!card) return 0;
  if (typeof card.getCounter === "function") {
    return card.getCounter(counterType) || 0;
  }
  if (card.counters instanceof Map) {
    return card.counters.get(counterType) || 0;
  }
  if (card.counters && typeof card.counters === "object") {
    return card.counters[counterType] || 0;
  }
  return 0;
}

export function getCounterValue(card, counterType = "counter") {
  if (!card) return 0;
  const key = counterType || "counter";
  const counters = card.counters;
  if (counters instanceof Map) return counters.get(key) || 0;
  if (counters && typeof counters === "object") {
    const upperKey = typeof key === "string" ? key.toUpperCase() : key;
    return counters[key] || counters[upperKey] || 0;
  }
  return 0;
}

export function setCounterValue(card, counterType = "counter", value = 0) {
  if (!card) return;
  const key = counterType || "counter";
  const nextValue = Math.max(0, Math.floor(value || 0));
  if (card.counters instanceof Map) {
    card.counters.set(key, nextValue);
    return;
  }
  if (!card.counters || typeof card.counters !== "object") card.counters = {};
  card.counters[key] = nextValue;
}
