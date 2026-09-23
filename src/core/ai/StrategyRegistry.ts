import type { AIStrategyBotPort } from "../contracts/ai.js";
import type { BotStrategyPort } from "../contracts/bot.js";

export type RegisteredStrategyConstructor = new (bot: AIStrategyBotPort) => BotStrategyPort;

import LuminarchStrategy from "./LuminarchStrategy.js";
import ShadowHeartStrategy from "./ShadowHeartStrategy.js";
import VoidStrategy from "./VoidStrategy.js";
import DragonStrategy from "./DragonStrategy.js";
import ArcanistStrategy from "./ArcanistStrategy.js";
import MirageboundStrategy from "./MirageboundStrategy.js";
import BloomrotStrategy from "./BloomrotStrategy.js";
import BurningWestStrategy from "./BurningWestStrategy.js";

const registry = new Map<string, RegisteredStrategyConstructor>();

export function registerStrategy(id: string | null | undefined, StrategyClass: RegisteredStrategyConstructor | null | undefined) {
  if (!id || !StrategyClass) return;
  registry.set(id, StrategyClass);
}

export function getStrategyFor(id: string, bot: AIStrategyBotPort): BotStrategyPort {
  const StrategyClass = registry.get(id) || ShadowHeartStrategy;
  return new StrategyClass(bot);
}

/** Planning must distinguish an unknown model from the live Bot's legacy fallback. */
export function resolveRegisteredStrategy(id: string | null | undefined): RegisteredStrategyConstructor | null {
  return id ? registry.get(id) || null : null;
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
