import LuminarchStrategy from "./LuminarchStrategy.js";
import ShadowHeartStrategy from "./ShadowHeartStrategy.js";
import VoidStrategy from "./VoidStrategy.js";

const registry = new Map();

export function registerStrategy(id, StrategyClass) {
  if (!id || !StrategyClass) return;
  registry.set(id, StrategyClass);
}

export function getStrategyFor(id, bot) {
  const StrategyClass = registry.get(id) || ShadowHeartStrategy;
  return new StrategyClass(bot);
}

export function getRegisteredStrategyIds() {
  return Array.from(registry.keys());
}

registerStrategy("shadowheart", ShadowHeartStrategy);
registerStrategy("luminarch", LuminarchStrategy);
registerStrategy("void", VoidStrategy);
