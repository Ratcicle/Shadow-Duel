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
};

export async function executeBotMainPhaseAction(bot, game, action) {
  if (!action) return false;
  const baseGuard = game.canStartAction({
    actor: bot,
    kind: "bot_main_action",
    phaseReq: ["main1", "main2"],
  });
  if (!baseGuard.ok) return false;

  const executor = EXECUTORS[action.type];
  if (!executor) return false;
  return executor(bot, game, action);
}

export function getBotMainPhaseActionExecutor(actionType) {
  return EXECUTORS[actionType] || null;
}
