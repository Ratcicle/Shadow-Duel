import LuminarchStrategy from "./LuminarchStrategy.js";
import ShadowHeartStrategy from "./ShadowHeartStrategy.js";
import VoidStrategy from "./VoidStrategy.js";
import DragonStrategy from "./DragonStrategy.js";
import ArcanistStrategy from "./ArcanistStrategy.js";
import MirageboundStrategy from "./MirageboundStrategy.js";
import BloomrotStrategy from "./BloomrotStrategy.js";
import BurningWestStrategy from "./BurningWestStrategy.js";

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
registerStrategy("dragon", DragonStrategy);
registerStrategy("arcanist", ArcanistStrategy);
registerStrategy("miragebound", MirageboundStrategy);
registerStrategy("bloomrot", BloomrotStrategy);
registerStrategy("burningwest", BurningWestStrategy);
