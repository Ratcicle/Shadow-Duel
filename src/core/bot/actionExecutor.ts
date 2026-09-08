import { executeAscensionAction } from "./actionExecutors/ascension.js";
import { executeExtraDeckProcedureAction } from "./actionExecutors/extraDeck.js";
import {
  executeSpecialSummonSanctumProtectorAction,
  executeSummonAction,
} from "./actionExecutors/summon.js";
import { executePositionChangeAction } from "./actionExecutors/position.js";
import {
  executeFieldEffectAction,
  executeGraveyardSpellEffectAction,
  executeSetSpellTrapAction,
  executeSpellAction,
  executeSpellTrapEffectAction,
} from "./actionExecutors/spellTrap.js";
import {
  executeGraveyardMonsterEffectAction,
  executeHandIgnitionAction,
  executeMonsterEffectAction,
} from "./actionExecutors/monsterEffects.js";

import type { BotRuntimePort, BotGamePort, BotMainPhaseActionExecutors, BotMainPhaseActionExecutor } from "../contracts/bot.js";
import type { AIAction, AIActionOf, AIActionType } from "../contracts/ai.js";

const EXECUTORS = {
  ascension: executeAscensionAction,
  extraDeckProcedure: executeExtraDeckProcedureAction,
  special_summon_sanctum_protector: executeSpecialSummonSanctumProtectorAction,
  position_change: executePositionChangeAction,
  summon: executeSummonAction,
  spell: executeSpellAction,
  set_spell_trap: executeSetSpellTrapAction,
  spellTrapEffect: executeSpellTrapEffectAction,
  graveyardSpellEffect: executeGraveyardSpellEffectAction,
  fieldEffect: executeFieldEffectAction,
  monsterEffect: executeMonsterEffectAction,
  graveyardMonsterEffect: executeGraveyardMonsterEffectAction,
  handIgnition: executeHandIgnitionAction,
} satisfies BotMainPhaseActionExecutors;

export async function executeBotMainPhaseAction<Type extends AIActionType>(bot: BotRuntimePort, game: BotGamePort, action: AIActionOf<Type> | null | undefined): Promise<boolean> {
  if (!action) return false;
  const baseGuard = game.canStartAction({
    actor: bot,
    kind: "bot_main_action",
    phaseReq: ["main1", "main2"],
  });
  if (!baseGuard.ok) return false;

  // The manifest correlates the discriminant with the executor argument.
  const executor = EXECUTORS[action.type] as BotMainPhaseActionExecutor<Type>;
  if (!executor) return false;
  return executor(bot, game, action);
}

export function getBotMainPhaseActionExecutor(actionType: string): BotMainPhaseActionExecutor<AIActionType> | null {
  return (EXECUTORS as Partial<Record<string, BotMainPhaseActionExecutor<AIActionType>>>)[actionType] || null;
}
