import type {
  DragonCard,
  DragonPlayer,
} from "./contracts.js";

import { getEffectiveAtk } from "../common/cardStats.js";
import { isExtremeDragon } from "./knowledge.js";

function isDragonMonster(card: DragonCard) {
  return card?.cardKind === "monster" && card.type === "Dragon";
}

function getPrintedAtk(card: DragonCard) {
  if (!card) return 0;
  if (Number.isFinite(card.baseAtk)) return Number(card.baseAtk);
  if (Number.isFinite(card.printedAtk)) return Number(card.printedAtk);
  if (Number.isFinite(card.originalAtk)) return Number(card.originalAtk);
  return card.name === "Boneflame Dragon" ? 0 : Number(card.atk || 0);
}

function getBoneflameAtkPassive(card: DragonCard) {
  for (const effect of card?.effects || []) {
    const passive = (effect as typeof effect & { passive?: import("../../contracts/effects.js").PassiveRuleDefinition })?.passive;
    if (passive?.type !== "graveyard_type_count_buff") continue;
    if (!(passive.stats || []).includes("atk")) continue;
    return passive;
  }
  return null;
}

function getProjectedGraveyardCount(owner: DragonPlayer, boneflame: DragonCard | null | undefined, costDragon: DragonCard, monsterType: string) {
  const graveyard = owner?.graveyard || [];
  let count = graveyard.filter(
    (card) =>
      card &&
      card.cardKind === "monster" &&
      (!monsterType || card.type === monsterType),
  ).length;

  if (
    costDragon &&
    !graveyard.includes(costDragon) &&
    costDragon.cardKind === "monster" &&
    (!monsterType || costDragon.type === monsterType)
  ) {
    count += 1;
  }

  if (
    boneflame &&
    graveyard.includes(boneflame) &&
    boneflame.cardKind === "monster" &&
    (!monsterType || boneflame.type === monsterType)
  ) {
    count -= 1;
  }

  return Math.max(0, count);
}

export function isProtectedBoneflameCost(card: DragonCard) {
  return isExtremeDragon(card) || card?.name === "Supreme Bahamut Dragon";
}

export function getProjectedBoneflameAtk(boneflame: DragonCard | null | undefined, costDragon: DragonCard, owner: DragonPlayer) {
  if (!boneflame || boneflame.name !== "Boneflame Dragon") return 0;

  const passive = getBoneflameAtkPassive(boneflame);
  if (!passive) return getPrintedAtk(boneflame);

  const monsterType = passive.monsterType || passive.type || "Dragon";
  const amountPerCard = Number(passive.amountPerCard || 0);
  const count = getProjectedGraveyardCount(
    owner,
    boneflame,
    costDragon,
    monsterType,
  );

  return getPrintedAtk(boneflame) + amountPerCard * count;
}

export function isValidBoneflameCost(boneflame: DragonCard | null | undefined, costDragon: DragonCard, owner: DragonPlayer) {
  if (!boneflame || boneflame.name !== "Boneflame Dragon") return false;
  if (!isDragonMonster(costDragon) || costDragon.isFacedown) return false;
  if (isProtectedBoneflameCost(costDragon)) return false;
  return (
    getProjectedBoneflameAtk(boneflame, costDragon, owner) >
    getEffectiveAtk(costDragon)
  );
}

export function getValidBoneflameCostCandidates(boneflame: DragonCard | null | undefined, owner: DragonPlayer) {
  return (owner?.field || []).filter((candidate) =>
    isValidBoneflameCost(boneflame, candidate, owner),
  );
}
