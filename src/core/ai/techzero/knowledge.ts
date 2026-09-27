import type { AiCardInput } from "../../contracts/aiState.js";

export const TECH_ZERO_IDS = {
  CORE: 501, ELECTROCATAPULT: 502, MULTIMODAL: 503, WYVERN: 504,
  RAPTOR: 505, PRISM: 506, CONNECTOR: 507, PULSE: 508, PORTAL: 509,
  SLASHER: 510, GHOST: 511, MAGE: 512, KAISER: 513, PHOENIX: 514,
  REACTOR: 515, LANCER: 516, SINGULARITY: 517, LAB: 518, ASSEMBLY: 519,
  SCRAPYARD: 520, COURT: 17,
} as const;

export type TechZeroRole = "tuner" | "synchro_tuner" | "starter" | "extender" |
  "recovery" | "payoff" | "support";

export function isTechZero(card: AiCardInput): boolean {
  return card.archetype === "Tech-Zero" || card.archetypes?.includes("Tech-Zero") === true;
}

/** Negation removes M's alternate material role, not its printed Tuner type. */
export function getTechZeroRole(card: AiCardInput): TechZeroRole {
  if (card.monsterType === "synchro" && card.isTuner) return "synchro_tuner";
  if (card.isTuner) return "tuner";
  switch (card.id) {
    case TECH_ZERO_IDS.ELECTROCATAPULT: return "starter";
    case TECH_ZERO_IDS.WYVERN:
    case TECH_ZERO_IDS.PRISM:
    case TECH_ZERO_IDS.CONNECTOR: return "extender";
    case TECH_ZERO_IDS.PORTAL:
    case TECH_ZERO_IDS.LAB:
    case TECH_ZERO_IDS.SCRAPYARD:
    case TECH_ZERO_IDS.COURT: return "recovery";
  }
  if (card.monsterType === "synchro") return "payoff";
  return "support";
}

/** Named states for explanation; search retention and scoring belong to Task 5. */
export const TECH_ZERO_MILESTONES = {
  MACHINE_ACCESS: "Multimodal with access to Core",
  PORTAL_RECOVERY: "Portal with three useful distinct names",
  SYNCHRO_TUNER: "Synchro Tuner and boss materials",
  PROTECTED_BOSS: "Boss directly protected by Slasher",
  FOLLOW_UP: "Reconstruction resources preserved",
} as const;
