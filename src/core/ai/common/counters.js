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
