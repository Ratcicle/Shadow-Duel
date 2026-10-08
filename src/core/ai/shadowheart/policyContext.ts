/** Shadow-Heart policyContext policies; preferences remain owned by the archetype. */
import type { ShadowHeartCard, ShadowHeartAnalysis, ShadowHeartPlanningGame } from "./contracts.js";
import type { AIStrategyBotPort } from "../../contracts/ai.js";
import { isShadowHeartByName, isShadowHeart } from "./knowledge.js";
import { getEffectiveAtk, getEffectiveDef } from "../common/cardStats.js";
import { assessSummonEntry } from "../common/summonAssessment.js";
import { fieldHasTributeValue } from "../../game/summon/tributeValue.js";




export type StrategyCard = ShadowHeartCard & { cannotBeDestroyedByBattle?: boolean | undefined; requiredTributes?: number };
export type FullAnalysis = Analysis & Required<Pick<Analysis, "hand" | "field" | "graveyard" | "oppField" | "lp" | "oppLp">>;
export type EntryOwner = { field?: readonly StrategyCard[]; fieldSpell?: StrategyCard | string | null };
export type EntryContext = { fieldSpell?: StrategyCard | string | null; analysis?: EntryOwner | null; player?: EntryOwner | null; bot?: EntryOwner | null; myField?: readonly StrategyCard[] };
export type Player = Omit<Partial<AIStrategyBotPort>, "field"> & { field?: StrategyCard[] };
export type PlanningGame = ShadowHeartPlanningGame;
export type Analysis = ShadowHeartAnalysis & { fieldCapacity?: number; spellTrapZone?: StrategyCard[] };
export interface Strategy { bot?: Player; analyzeGameState?(game: PlanningGame): Analysis; getOpponent?(game: PlanningGame, player: Player): Player | null; }
export type Context = Omit<NonNullable<Parameters<typeof assessSummonEntry>[1]>, "game" | "analysis" | "player" | "bot" | "opponent" | "myField" | "oppField"> & { analysis?: Analysis; bot?: Player; player?: Player; opponent?: Player | null; game?: PlanningGame; strategy?: Strategy; field?: StrategyCard[]; myField?: StrategyCard[]; oppField?: StrategyCard[]; fieldSpell?: StrategyCard | string | null; facedownValue?: number; clearsOpponentBoardOnSummon?: boolean; isEmergencyRemoval?: boolean | undefined; source?: StrategyCard | null; botState?: Player; ctx?: { source?: StrategyCard }; getOpponent?(game: PlanningGame, player: Player): Player | null };

// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/shadowheart/priorities.js
// Lógica de priorização: spell decisions, summon decisions, safety checks.
//
// RESOURCE CONSERVATION PATTERN:
// - Spells de buff ATK/combat (Battle Hymn, Rage) só ativam em Main Phase 1
// - Evita desperdiçar recursos em Main Phase 2 (pós-Battle)
// - Use analysis.phase para detectar timing apropriado
// ─────────────────────────────────────────────────────────────────────────────


export const SHADOW_HEART_OFFENSIVE_PAYOFFS = [
  "Polymerization",
  "Shadow-Heart Scale Dragon",
  "Shadow-Heart Demon Arctroth",
  "Shadow-Heart Death Wyrm",
  "Shadow-Heart Leviathan",
  "Shadow-Heart Purge",
  "Shadow-Heart Rage",
  "Shadow-Heart Battle Hymn",
  "The Shadow Heart",
];

export const SH = {
  covenant: "Shadow-Heart Covenant",
  cathedral: "Shadow-Heart Cathedral",
  valley: "Darkness Valley",
  poly: "Polymerization",
  infusion: "Shadow-Heart Infusion",
  voidMage: "Shadow-Heart Void Mage",
  heartbearer: "Shadow-Heart Heartbearer",
  courtOfTheDead: "Court of the Dead",
  imp: "Shadow-Heart Imp",
  gecko: "Shadow-Heart Gecko",
  eel: "Shadow-Heart Abyssal Eel",
  leviathan: "Shadow-Heart Leviathan",
  scale: "Shadow-Heart Scale Dragon",
  arctroth: "Shadow-Heart Demon Arctroth",
  arctrothPursuer: "Shadow-Heart Arctroth Pursuer",
  devastation: "Shadow-Heart Devastation Dragon",
  deathWyrm: "Shadow-Heart Death Wyrm",
  griffin: "Shadow-Heart Griffin",
  specter: "Shadow-Heart Specter",
  coward: "Shadow-Heart Coward",
  rage: "Shadow-Heart Rage",
  battleHymn: "Shadow-Heart Battle Hymn",
  demonDragon: "Shadow-Heart Demon Dragon",
  warlord: "Shadow-Heart Warlord",
};

export const SHADOW_HEART_STARTERS = [SH.voidMage, SH.imp, SH.eel, SH.gecko];
export const LOW_VALUE_DISCARDS = [SH.coward, SH.specter, SH.rage, SH.gecko];
export const SHADOW_HEART_BOSS_SUMMON_NAMES = new Set([
  SH.scale,
  SH.arctroth,
  SH.deathWyrm,
  SH.leviathan,
  SH.demonDragon,
  SH.warlord,
  SH.arctrothPursuer,
  SH.devastation,
]);
export const SHADOW_HEART_ENGINE_SUMMON_NAMES = new Set([
  SH.voidMage,
  SH.imp,
  SH.gecko,
  SH.specter,
  SH.coward,
  SH.eel,
]);


function getCardName(value: string | StrategyCard | null | undefined) {
  return typeof value === "string" ? value : value?.name || null;
}


function hasActiveOwnFieldSpell(context: EntryContext = {}, name: string) {
  const candidates = [
    context.fieldSpell,
    context.analysis?.fieldSpell,
    context.player?.fieldSpell,
    context.bot?.fieldSpell,
  ];
  return candidates.some((candidate) => getCardName(candidate) === name);
}


function isDragonType(card: StrategyCard) {
  if (!card) return false;
  const requiredType = "dragon";
  if (Array.isArray(card.types)) {
    return card.types.some(
      (type) => String(type || "").toLowerCase() === requiredType,
    );
  }
  return String(card.type || "").toLowerCase() === requiredType;
}


export function isShadowHeartDragon(card: StrategyCard) {
  return (
    card?.cardKind === "monster" &&
    !card.isFacedown &&
    isDragonType(card) &&
    (isShadowHeart(card) || isShadowHeartByName(card.name))
  );
}


function sameCardInstance(a: StrategyCard | null | undefined, b: StrategyCard | null | undefined) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.instanceId && b.instanceId) return a.instanceId === b.instanceId;
  return false;
}


function isAlreadyOnOwnField(card: StrategyCard, context: EntryContext = {}) {
  const field =
    context.myField ||
    context.player?.field ||
    context.bot?.field ||
    context.analysis?.field ||
    [];
  return (field || []).some((fieldCard) => sameCardInstance(card, fieldCard));
}


function hasNamedAtkBuff(card: StrategyCard, sourceName: string) {
  return Number(card?.permanentBuffsBySource?.[sourceName]?.atk || 0) > 0;
}


export function projectShadowHeartEntryStats(card: StrategyCard, context: EntryContext = {}, stats: { atk?: number | undefined; def?: number } = {}) {
  const projected = {
    atk: stats.atk ?? getEffectiveAtk(card),
    def: stats.def ?? getEffectiveDef(card),
  };

  if (!isShadowHeartByName(card?.name)) return projected;
  if (!hasActiveOwnFieldSpell(context, SH.valley)) return projected;
  if (isAlreadyOnOwnField(card, context)) return projected;
  if (hasNamedAtkBuff(card, SH.valley)) return projected;

  return {
    ...projected,
    atk: projected.atk + 300,
  };
}


export function cardCountByName(cards: StrategyCard[] = []) {
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (!card?.name) continue;
    counts.set(card.name, (counts.get(card.name) || 0) + 1);
  }
  return counts;
}


export function allCards(analysis: Analysis, zones: Array<"hand" | "field" | "graveyard" | "deck" | "extraDeck" | "spellTrap"> = ["hand", "field"]) {
  return zones.flatMap<StrategyCard>((zone) => analysis?.[zone] || []);
}


export function hasName(cards: StrategyCard[] = [], name: string) {
  return cards.some((card) => card?.name === name);
}


function countName(cards: StrategyCard[] = [], name: string) {
  return cards.filter((card) => card?.name === name).length;
}


export function hasShadowHeartStarter(cards: StrategyCard[] = []) {
  return cards.some((card) => SHADOW_HEART_STARTERS.includes(card?.name!));
}


export function hasLevel8PlusShadowHeart(cards: StrategyCard[] = [], { excludeScale = false } = {}) {
  return cards.some(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      isShadowHeartByName(card.name) &&
      (card.level || 0) >= 8 &&
      (!excludeScale || card.name !== SH.scale),
  );
}


export function hasUsefulImpTarget(cards: StrategyCard[] = []) {
  return cards.some(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      isShadowHeartByName(card.name) &&
      (card.level || 0) <= 4 &&
      card.name !== SH.imp,
  );
}


export function hasOpponentPressure(analysis: Analysis) {
  const oppField = analysis?.oppField || [];
  return (
    oppField.length >= 2 ||
    oppField.some((card) => !card?.isFacedown && (card?.atk || 0) >= 2200)
  );
}


export function getCandidateByName(candidates: StrategyCard[] = [], names: string[] = []) {
  for (const name of names) {
    const match = candidates.find((card) => card?.name === name);
    if (match) return match;
  }
  return null;
}


export function isReadyShadowHeartAttacker(card: StrategyCard) {
  return (
    card &&
    card.cardKind === "monster" &&
    isShadowHeartByName(card.name) &&
    !card.isFacedown &&
    card.position === "attack" &&
    !card.cannotAttackThisTurn &&
    !card.hasAttacked
  );
}


export function shouldPreserveScaleForDemonLine(analysis: Analysis) {
  const cards = allCards(analysis);
  const hasPoly = hasName(analysis?.hand || [], SH.poly);
  const hasScale = hasName(cards, SH.scale);
  const hasLevel8 = hasLevel8PlusShadowHeart(cards, { excludeScale: true });
  const hasNearbySearch =
    hasName(analysis?.hand || [], SH.covenant) && isCovenantLive(analysis);
  const urgentBoard = hasOpponentPressure(analysis) || (analysis?.lp || 8000) <= 2500;

  if (!hasScale || urgentBoard) return false;
  if (hasPoly && hasLevel8) return false;
  if (hasPoly && !hasLevel8) return true;
  return hasNearbySearch;
}


function getShadowHeartTributesNeeded(card: StrategyCard) {
  if (!card || !isShadowHeartByName(card.name)) return 0;
  if (card.name === SH.scale) return 3;
  if ((card.level || 0) >= 7) return 2;
  if ((card.level || 0) >= 5) return 1;
  return 0;
}


function getTributeBossesInHand(analysis: Analysis = {}) {
  return (analysis.hand || []).filter(
    (card) => card && card.cardKind === "monster" && getShadowHeartTributesNeeded(card) > 0,
  );
}


export function heartbearerCompletesTributeLine(analysis: Analysis = {}) {
  const field = analysis.field || [];
  if ((analysis.fieldCapacity ?? Math.max(0, 5 - field.length)) <= 0) return false;
  const bosses = getTributeBossesInHand(analysis);
  return bosses.some((boss) => {
    const needed = getShadowHeartTributesNeeded(boss);
    if (fieldHasTributeValue(field, needed, boss)) return false;
    return fieldHasTributeValue([...field, { name: SH.heartbearer, cardKind: "monster" }], needed, boss);
  });
}


export function isCovenantLive(analysis: Analysis) {
  const controlledCards =
    (analysis?.field?.length || 0) +
    (analysis?.spellTrap?.length || 0) +
    (analysis?.fieldSpell ? 1 : 0);
  return controlledCards === 0;
}
