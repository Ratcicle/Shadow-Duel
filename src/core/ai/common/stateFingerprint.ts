import type {
  AiStateInput,
  AiStateShape,
  SimulatedCardShape,
  SimulatedPlayerState,
} from "../../contracts/aiState.js";
import type { GameRuntimeState } from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";

// Explicit planning projection, shared with the Beam/Greedy copy boundary so
// newly compared mutable data cannot silently disappear at the next depth.
// This is NOT the canonical replay projection or a claim of engine parity.
export const PLANNING_ZONES = [
  "hand", "field", "spellTrap", "graveyard", "deck", "extraDeck", "banished",
] as const satisfies readonly (keyof SimulatedPlayerState)[];

export const PLANNING_PLAYER_FIELDS = [
  "id", "lp", "controllerType", "summonCount", "additionalNormalSummons",
  "additionalNormalSummonPermissions", "normalSummonsThisTurn",
  "specialSummonRestrictions", "effectActivationRestrictions",
  "forbidDirectAttacksThisTurn", "oncePerTurnUsageByName", "usedEffects",
  "_simMaterialEffectActivationsByMaterialId", "oncePerDuelUsageByName",
  "lpGainMultiplier", "lpGainedThisTurn", "damageReceivedThisTurn",
] as const satisfies readonly (keyof SimulatedPlayerState | keyof GamePlayer)[];

// Consumers: simulation.ts / simStateUtils (OPT), simulatedActions/shared
// (passives, field presence), movement (control IDs), Arcanist/Void/Dragon
// simulators and Burning West rewards. Only data already supplied is copied;
// neither this module nor the copy boundary reads effectEngine or _gameRef.
// Temporary registrations come from flow/combat/movement and are read by
// simulation.ts event dispatch and simulatedConditions.ts duration checks.
export const PLANNING_STATE_FIELDS = [
  "turn", "phase", "turnCounter", "_isPerspectiveState", "gameOver", "winner",
  "usedThisTurn", "_simOncePerTurn", "_dragonSimOnce", "_simOptUsed",
  "_simArcanistOptUsed", "_simPassiveOncePerTurn", "_simReplacementEffects",
  "_simTemporaryControlCounter", "_simFieldPresenceSeq", "_simEventDepth",
  "_simPlanningBattleDone", "_simGrandLibraryBattleRewardUsed",
  "_simArcanistApprenticeSearchUsed", "_simArcanistSpellActivations",
  "_simBurningWest", "_simMaterialEffectActivationsByMaterialId",
  "_simVoidBeastSearchUsed", "_simVoidHollowRecruitUsed",
  "temporaryEventEffects", "temporaryControlEffects", "temporaryBattlePairEffects",
] as const satisfies readonly (keyof AiStateShape | keyof GameRuntimeState)[];

export const PLANNING_CARD_LINKS = [
  "equippedTo", "equipTarget", "boundTrapSource", "boundMonsterTarget", "sourceCard",
] as const satisfies readonly (keyof SimulatedCardShape)[];

// Raw stats AND their contributing/expiry metadata are intentional. The
// effective-stat helpers collapse durations and are insufficient for identity.
export const PLANNING_CARD_FIELDS = [
  "id", "duelCardId", "instanceId", "_instanceId", "uid", "uuid", "simInstanceId",
  "name", "cardKind", "originalCardKind", "treatedAsCardKinds", "subtype",
  "monsterType", "isTuner", "synchroMaterialRoles", "archetypes", "archetype",
  "baseAtk", "baseDef", "atk", "def", "type", "types", "attribute", "level",
  "baseLevel", "originalLevel", "position", "previousPosition",
  "positionChangedThisTurn", "revealedTurn", "isFacedown", "battlePositionLocked",
  "hasAttacked", "extraAttacks", "baseExtraAttackTargetRestriction",
  "extraAttackTargetRestriction", "dynamicExtraAttacks", "attackLimitThisTurn",
  "attackLimitDuration", "attacksUsedThisTurn", "tempAtkBoost", "tempDefBoost",
  "cannotAttackThisTurn", "cannotAttackUntilTurn", "immuneToOpponentEffectsUntilTurn",
  "altTribute", "tributeValue", "onBattleDestroy", "canAttackDirectlyThisTurn",
  "cannotAttackDirectly", "summonRestrict", "fieldLimit", "fieldPresenceRestriction",
  "extraDeckSummonProcedure", "equipAtkBonus", "equipDefBonus", "equipExtraAttacks",
  "grantsBattleIndestructible", "battleIndestructible", "tempBattleIndestructible",
  "battleDamageHealsControllerThisTurn", "preventsBattleDamageToController",
  "battleIndestructibleOncePerTurn", "battleIndestructibleOncePerTurnUsed",
  "battleIndestructibleOncePerTurnLastUsedTurn", "mustBeAttacked", "piercing",
  "piercingDamageMultiplier", "canMakeSecondAttackThisTurn", "secondAttackUsedThisTurn",
  "dynamicBuffs", "suppressedDynamicBuffStatsByKey",
  "temporarySuppressedDynamicBuffStatsByKey", "passiveExtraAttackBonuses",
  "passiveExtraAttackTargetRestriction", "cannotBeSpecialSummoned",
  "cannotBeNormalSummonedOrSet", "specialSummonOnlyBy", "mustFirstBeSpecialSummonedBy",
  "properSummonEstablished", "properSummonProcedure", "unaffectedByOtherCardEffects",
  "lastSummonMethod", "lastSummonedFromZone", "lastSummonedTurn", "lastSummonProcedure",
  "turnBasedBuffs", "tempStatuses", "fieldExitStatuses", "fieldPresenceId",
  "fieldPresenceState", "effectsNegated", "effectsNegatedDuration", "originalAtk",
  "originalDef", "counters", "blueprintStorage", "effects", "fusionMaterials",
  "ascension", "ascensionMaterials", "synchro", "synchroMaterials", "owner",
  "originalOwner", "controller", "location", "zone", "locationVersion", "isToken",
  "tokenSourceCard", "isTrapMonster", "trapMonsterOriginalState",
  "trapMonsterSummonProcedure", "setTurn", "turnSetOn", "enteredFieldTurn",
  "summonedTurn", "summonPending", "requiredTributes", "lpGainMultiplier",
  "declaredValues", "oncePerTurnUsageByName", "oncePerTurnResetVersion",
  "effectMarkers", "protectionEffects", "permanentBuffsBySource",
  "linkedPermanentBuffSourceNames", "originalStatsOverride", "banishWhenLeavesField",
  "grantsCrescentShieldGuard", "lastSentToGraveAsMaterial", "graveyardEffectActivating",
  "attackedMonstersThisTurn", "canAttackAllOpponentMonstersThisTurn", "dynamicStatBoosts",
  "permanentDefBoost", "permanentAtkBoost", "cannotBeDestroyedByBattle",
  "cannotBeDestroyedByCardEffects", "fieldAgeTurns", "destroyedOpponentMonstersByEffect",
  "lastTributeMaterialNames", "lastTributeMaterialCount", "multiAttackLimit",
  "simEffectDestructionProtected", "simFutureRevive", "simLevelReducedUntilEndTurn",
  "simMultiAttackPressure", "simProtectedBy", "simProtectedUntilNextTurn",
  "lastAiActivatedTurn", "goodDiscard", "usedEffectThisTurn", "__simSetAfterResolution",
  "_simArcanistApprenticeAuraAtk", "_simArcanistAzrathEquipHalveUsed",
  "_simArcanistAzrathHalvedByEquip", "_simArcanistAzrathSpellDebuffAtk",
  "_simArcanistAzrathSpellDebuffDef", "_simArcanistElementalistSpellBuffAtk",
  "_simArcanistLightningAtkBoost", "_simArcanistLightningAttackLock",
  "_simArcanistLightningPiercing", "_simBloomrotCarrioncapMarkedBattle",
  "_simBloomrotRotStagBattleBoost", "_simBurningWestSheriffDamageStepBoost",
  "_simCannotAttackByEffect", "_simDarknessValleyBuff", "_simEffectDestructionProtected",
  "_simEffectDestructionProtectedFromOpponent", "_simEffectDestructionProtectedFromSelf",
  "_simElementalistDestroyedOnEquip", "_simMagicSickleBattleBoost",
  "_simMasterMirrorsShuffleDraw", "_simMasterRevivedOnEquip", "_simProtectedByRaven",
  "_simProtection", "_simProtectionEffects", "_simRecoveredOnEquip",
  "_simReplacementProtection", "_simStoredBlueprintSource", "_simStoredByGrimoire",
  "_simBattleDestructionProtected", "_simulatedAegisSpecialDefApplied",
  "_simulatedBarbariasBoost", "_simulatedCitadelSearch", "_simulatedHalberdFollowUp",
  "_simulatedLpCostReductionAvailable", "_simulatedLpPayoff", "_simulatedMarshalSelfSummon",
  "_simulatedMaterialsUsed", "_simulatedMoonbladeRevive", "_simulatedRole",
  "_searchedAegis", "_searchedSpell", "simBattleDestructionProtected", "_simPotentialBarbariasPush",
] as const satisfies readonly (keyof SimulatedCardShape)[];

// Legacy read projections still used by stats.ts, Bloomrot analysis and
// simulatedConditions.ts. Keep these explicit instead of opening the schema.
export const PLANNING_LEGACY_CARD_FIELDS = [
  "hasChangedPosition", "cannotBeDestroyedByOpponentCardEffects",
  "cannotBeDestroyedByOwnCardEffects", "status", "ownerId", "controllerId",
  "currentController", "faceDown", "faceUp", "storedBlueprints",
  "blueprintStorageState", "storedEffects",
  "destroyAtEndPhase", "destroyAtEndPhaseTurn", "destroyAtEndPhaseSource",
] as const;

const LUMINARCH_RESOURCE_FIELDS = [
  "halberdSummonedThisTurn", "barbariasLpPayoff", "magicSickleBattleUsed",
  "pureKnightDiscountAvailable", "sunforgedBattleProtectionUsed",
] as const;

type CanonicalValue = null | boolean | number | string | CanonicalValue[];

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

/**
 * Internal planning identity over the supplied projection only. Missing data
 * stays missing; no engine, database, UI, methods or live-state lookups occur.
 * Instance IDs are preserved across clones. Legacy cards without one use their
 * first zone/index (or link path): deterministic within the projection, but
 * unable to identify indistinguishable copies after an identity-free swap.
 * Equipment is a table of identities, never recursively serialized cards.
 * Unsupported-action reports, Luminarch histories/milestones, UI and search
 * diagnostics are excluded. The projection covers the declared fields below,
 * not unmodeled engine/Chain state or data absent from the planner input.
 */
export function fingerprintPlanningState(state: AiStateInput): string {
  const identities = new Map<object, string>();
  const cards = new Map<string, object>();
  const pending: Array<[string, object]> = [];

  function cardReference(card: unknown, path: string): CanonicalValue {
    if (!isObject(card)) return normalize(card, path);
    let identity = identities.get(card);
    if (identity === undefined) {
      for (const key of ["duelCardId", "instanceId", "_instanceId", "uid", "uuid", "simInstanceId"] as const) {
        const value: unknown = Reflect.get(card, key);
        if (typeof value === "string" || typeof value === "number") {
          identity = JSON.stringify([key, value]);
          break;
        }
      }
      identity ??= JSON.stringify(["legacy-path", path]);
      identities.set(card, identity);
      if (!cards.has(identity)) {
        cards.set(identity, card);
        pending.push([identity, card]);
      }
    }
    return ["card", identity];
  }

  const ancestors = new Set<object>();
  function normalize(value: unknown, path: string): CanonicalValue {
    if (value === null || typeof value === "boolean" || typeof value === "string") return value;
    if (typeof value === "number") {
      return Number.isFinite(value) && !Object.is(value, -0) ? value : ["number", String(value), Object.is(value, -0)];
    }
    if (!isObject(value)) return ["undefined"];
    if (identities.has(value)) return cardReference(value, path);
    if (ancestors.has(value)) throw new TypeError("Cyclic non-card planning metadata");
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        return ["array", Array.from({ length: value.length }, (_, i) =>
          i in value ? normalize(value[i], `${path}/${i}`) : ["hole"])];
      }
      if (value instanceof Map) {
        const entries = [...value].map(([key, entry]) => [normalize(key, path), normalize(entry, path)]);
        entries.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
        return ["map", entries];
      }
      if (value instanceof Set) {
        const entries = [...value].map(entry => normalize(entry, path));
        entries.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
        return ["set", entries];
      }
      return project(value, Object.keys(value).filter(key => key !== "_gameRef").sort(), path);
    } finally {
      ancestors.delete(value);
    }
  }

  function project(source: object, keys: readonly string[], path: string): CanonicalValue {
    const entries: CanonicalValue[] = [];
    for (const key of keys) {
      if (!(key in source)) continue;
      const value: unknown = Reflect.get(source, key);
      if (typeof value === "function") continue;
      const nestedPath = `${path}/${key}`;
      // Replacement metadata may point to cards that are no longer in a zone.
      // Such references obey the same identity-table boundary as equipment.
      const isCardLink = key === "sourceCard" || key === "targetCard" ||
        key === "firstTarget" || key === "secondTarget" || key === "affectedTarget";
      entries.push([key, isCardLink && isObject(value)
        ? cardReference(value, nestedPath) : normalize(value, nestedPath)]);
    }
    return ["object", entries];
  }

  // Register every zone first so links prefer the actual zone identity, even
  // for legacy fixtures, independently of card property insertion order.
  for (const seat of ["bot", "player", "opponent"] as const) {
    const player = state[seat];
    if (!player) continue;
    for (const zone of PLANNING_ZONES) {
      player[zone]?.forEach((card, index) => cardReference(card, `${seat}/${zone}/${index}`));
    }
    if (player.fieldSpell) cardReference(player.fieldSpell, `${seat}/fieldSpell`);
  }
  const players = ["bot", "player", "opponent"].map(seat => {
    const player: unknown = Reflect.get(state, seat);
    return [seat, isObject(player)
      ? project(player, [...PLANNING_PLAYER_FIELDS, ...PLANNING_ZONES, "fieldSpell"], seat)
      : normalize(player, seat)];
  });
  const stateData = project(state, PLANNING_STATE_FIELDS, "state");
  const luminarch: unknown = Reflect.get(state, "_simLuminarch");
  const resourceData = isObject(luminarch)
    ? project(luminarch, LUMINARCH_RESOURCE_FIELDS, "luminarch")
    : project({}, LUMINARCH_RESOURCE_FIELDS, "luminarch");
  const cardData: Array<[string, CanonicalValue]> = [];
  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i];
    if (!entry) continue;
    const [identity, card] = entry;
    const links: CanonicalValue[] = [];
    for (const key of PLANNING_CARD_LINKS) {
      if (key in card) links.push([key, cardReference(Reflect.get(card, key), `${identity}/${key}`)]);
    }
    if ("equips" in card) {
      const equips: unknown = Reflect.get(card, "equips");
      links.push(["equips", Array.isArray(equips)
        ? Array.from({ length: equips.length }, (_, index) => index in equips
          ? cardReference(equips[index], `${identity}/equips/${index}`) : ["hole"])
        : normalize(equips, identity)]);
    }
    const storage: unknown = Reflect.get(card, "state");
    cardData.push([identity, [
      project(card, [...PLANNING_CARD_FIELDS, ...PLANNING_LEGACY_CARD_FIELDS], identity),
      links,
      project(isObject(storage) ? storage : {}, ["blueprintStorage"], identity),
    ]]);
  }
  cardData.sort(([a], [b]) => compare(a, b));
  return JSON.stringify([stateData, players, resourceData, cardData]);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
