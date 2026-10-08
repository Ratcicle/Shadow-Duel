import type { MirageboundAnalysis, MirageboundCard, MirageboundGame, MirageboundOwner, MirageboundPlayer } from "./contracts.js";
import { getEffectiveAtk, getEffectiveDef } from "../common/cardStats.js";
export { getEffectiveAtk, getEffectiveDef, getBattleStat } from "../common/cardStats.js";

export const MIRAGEBOUND = "Miragebound";

export const MB = Object.freeze({
  SCOUT: "Miragebound Scout",
  DANCER: "Miragebound Dancer",
  JACKAL: "Miragebound Jackal",
  OASIS: "Miragebound Oasis",
  GLASS_SOVEREIGN: "Miragebound Glass Sovereign",
  GLASS_VIPER: "Miragebound Glass Viper",
  SAND_PRIESTESS: "Miragebound Sand Priestess",
  FALSE_KING: "Miragebound False King",
  MIRROR_PATH: "Miragebound Mirror Path",
  FALSE_HORIZON: "Miragebound False Horizon",
  VANISHING_STEP: "Miragebound Vanishing Step",
  HEAT_HAZE: "Miragebound Heat Haze",
  DESERT_LEVIATHAN: "Miragebound Desert Leviathan",
  REBEL: "Miragebound Rebel",
});

export const OASIS_RETURN_LABEL = 'Return a "Miragebound" monster; weaken an opponent monster';

export const OASIS_SHIFT_LABEL = "Change an opponent monster's position";

export const RETURN_TARGET_IDS = [
  "miragebound_dancer_bounce_target",
  "miragebound_oasis_return_target",
  "miragebound_false_horizon_return_target",
  "miragebound_vanishing_step_return_target",
  "miragebound_glass_sovereign_return_self_target",
];

export const RECURSION_TARGET_IDS = [
  "miragebound_sand_priestess_recover_target",
];

export const DEFENSIVE_CHAIN_RESPONSE_NAMES = new Set<string | null | undefined>([
  MB.FALSE_HORIZON,
  MB.VANISHING_STEP,
]);

export function isSimulatedState(game: MirageboundGame) {
  return game?._isPerspectiveState === true;
}

export function isMiragebound(card: MirageboundCard | null | undefined): card is MirageboundCard {
  return (
    card?.archetype === MIRAGEBOUND ||
    (Array.isArray(card?.archetypes) && card.archetypes.includes(MIRAGEBOUND))
  );
}

export function isFaceUpMonster(card: MirageboundCard | null | undefined): card is MirageboundCard {
  return card?.cardKind === "monster" && !card.isFacedown;
}

export function isFaceUpMirageboundMonster(card: MirageboundCard | null | undefined): card is MirageboundCard {
  return isFaceUpMonster(card) && isMiragebound(card);
}

export function hasName(cards: MirageboundCard[] = [], name: string) {
  return (cards || []).some((card) => card?.name === name);
}

export function hasPositionChangeEffectAccess(base: Partial<import("../common/analysis.js").StrategyAnalysis<MirageboundPlayer>> = {}, faceUpMiragebounds: MirageboundCard[] = []) {
  const hand = base.hand || [];
  const spellTrap = base.spellTrap || [];
  const controlsMiragebound = faceUpMiragebounds.length > 0;
  return (
    hasName(faceUpMiragebounds, MB.SCOUT) ||
    hasName(faceUpMiragebounds, MB.SAND_PRIESTESS) ||
    hasName(faceUpMiragebounds, MB.FALSE_KING) ||
    hasName(faceUpMiragebounds, MB.GLASS_SOVEREIGN) ||
    base.fieldSpell?.name === MB.OASIS ||
    (controlsMiragebound && hasName(hand, MB.HEAT_HAZE)) ||
    (controlsMiragebound &&
      (hasName(hand, MB.VANISHING_STEP) ||
        hasName(spellTrap, MB.VANISHING_STEP)))
  );
}

export function getMaterialEffectActivations(game: MirageboundGame | null | undefined, player: MirageboundPlayer, materialId: number) {
  if (!player || !Number.isFinite(materialId)) return 0;
  const stats = game?.materialDuelStats || game?._gameRef?.materialDuelStats;
  return (
    stats?.[
      player.id
    ]?.effectActivationsByMaterialId?.get?.(materialId) || 0
  );
}

export function getFieldCapacity(player: MirageboundPlayer) {
  return Math.max(0, 5 - ((player?.field || []).length || 0));
}

export function getOpponentCards(analysis: Pick<MirageboundAnalysis,"oppField"|"oppSpellTrap"|"oppFieldSpell">): MirageboundCard[] {
  return [
    ...(analysis.oppField || []),
    ...(analysis.oppSpellTrap || []),
    ...(analysis.oppFieldSpell ? [analysis.oppFieldSpell] : []),
  ].filter(Boolean);
}

export function getCardInstanceIds(card: MirageboundCard | null | undefined) {
  return [
    card?.instanceId,
    card?._instanceId,
    card?.uid,
    card?.uuid,
    card?.simInstanceId,
    card?.fieldPresenceId,
  ].filter((id) => id !== null && id !== undefined);
}

export function getCardsByNames(cards: MirageboundCard[] = [], names: string[] = []) {
  const wanted = new Set<string | undefined>(names);
  return (cards || []).filter((card) => wanted.has(card?.name));
}

export function getInstanceIds(cards: Array<MirageboundCard | null | undefined> = []) {
  const result: ReturnType<typeof getCardInstanceIds> = [];
  const seen = new Set<string>();
  for (const id of (cards || []).flatMap(getCardInstanceIds)) {
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(id);
  }
  return result;
}

export function hasCardStatus(card: MirageboundCard, status: Extract<keyof MirageboundCard,string>) {
  if (!card || !status) return false;
  if (card[status]) return true;
  if (Array.isArray((card as {statuses?:string[]}).statuses) && (card as {statuses?:string[]}).statuses!.includes(status)) return true;
  if ((card as {status?:string}).status === status) return true;
  return false;
}

export function getOwnerId(ownerLike: MirageboundOwner | MirageboundCard | undefined) {
  if (!ownerLike) return null;
  if (typeof ownerLike === "string") return ownerLike;
  return ownerLike.id || ownerLike.controller || ownerLike.owner || null;
}

export function uniqueValues<Value>(values: Value[] = []): Value[] {
  const seen = new Set<string>();
  const result: Value[] = [];
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function getBestOwnBattleStat(analysis: MirageboundAnalysis = {} as MirageboundAnalysis) {
  const ownMonsters = (analysis.field || []).filter(isFaceUpMonster);
  return ownMonsters.reduce(
    (best, card) => Math.max(best, getEffectiveAtk(card), getEffectiveDef(card)),
    0,
  );
}

export function isAttackPositionThreat(card: MirageboundCard) {
  return card?.cardKind === "monster" && !card.isFacedown && card.position === "attack";
}
