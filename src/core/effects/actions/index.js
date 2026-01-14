/**
 * Actions module barrel file.
 * Re-exports all action-related functionality from sub-modules.
 */

// Core dispatcher
export { applyActions, checkActionPreviewRequirements } from "./core.js";

// Resource actions (draw, heal, damage)
export {
  applyDraw,
  applyHeal,
  applyHealPerArchetypeMonster,
  applyDamage,
} from "./resources.js";

// Destroy actions
export {
  applyDestroy,
  checkBeforeDestroyNegations,
  promptForDestructionNegation,
  getDestructionNegationCostDescription,
  applyDestroyAllOthersAndDraw,
  applyDestroyOtherDragonsAndBuff,
  applyMirrorForceDestroy,
} from "./destroy.js";

// Combat actions
export {
  applyNegateAttack,
  applyForbidAttackThisTurn,
  applyForbidAttackNextTurn,
  applyAllowDirectAttackThisTurn,
  applyForbidDirectAttackThisTurn,
} from "./combat.js";

// Summon actions
export {
  applySpecialSummonToken,
  applyCallOfTheHauntedSummon,
} from "./summon.js";

// Stats actions
export { applyBuffAtkTemp, applyModifyStatsTemp } from "./stats.js";

// Equip actions
export { applyEquip, showSickleSelectionModal } from "./equip.js";

// Movement actions
export { applyMove } from "./movement.js";

// Counter actions
export { applyAddCounter } from "./counters.js";

// Immunity actions
export { applyGrantVoidFusionImmunity } from "./immunity.js";
