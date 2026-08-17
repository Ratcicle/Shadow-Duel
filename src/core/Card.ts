import type {
  AlternateTributeDefinition,
  AscensionDefinition,
  AscensionMaterialRecord,
  BattlePosition,
  BlueprintStorageDefinition,
  CardAttribute,
  CardConstructorData,
  CardDeclaredValueMap,
  CardDynamicBuffMap,
  CardDynamicStatBoost,
  CardEffectMarkerMap,
  CardKind,
  CardProtectionEffect,
  CardOriginalStatsOverride,
  CardPermanentBuffMap,
  CardStatusRegistry,
  CardSuppressedDynamicBuffStats,
  CardSubtype,
  CardTurnBasedBuff,
  DynamicExtraAttacksDefinition,
  EffectUsageMap,
  ExtraDeckSummonProcedure,
  FieldLimitDefinition,
  FieldPresenceRestriction,
  FusionMaterialDefinition,
  GameCard,
  MonsterRace,
  MonsterType,
  SpecialSummonProcedure,
  SynchroDefinition,
  SynchroMaterialRecord,
  SynchroMaterialRoles,
  SentToGraveMaterialMarker,
  TrapMonsterOriginalState,
  TributeValueDefinition,
} from "./contracts/cards.js";
import type { EffectDefinition } from "./contracts/effects.js";
import type {
  CardDefinitionId,
  DuelCardId,
  PlayerId,
  RawCardDefinitionId,
} from "./contracts/primitives.js";
import type { SummonMethod } from "./contracts/summon.js";
import type { CanonicalZone } from "./contracts/zones.js";

let nextCardInstanceId = 1;

function isObjectValue(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function readProperty(value: unknown, key: PropertyKey): unknown {
  return isObjectValue(value) ? Reflect.get(value, key) : undefined;
}

function cloneJsonValue<Value>(value: Value): Value {
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  return parsed as Value;
}

export function getCardLocationVersion(card: unknown): number {
  const version = Number(readProperty(card, "locationVersion") ?? 0);
  return Number.isFinite(version) && version >= 0 ? version : 0;
}

export function bumpCardLocationVersion(card: unknown): number {
  if (!isObjectValue(card)) return 0;
  const nextVersion = getCardLocationVersion(card) + 1;
  Reflect.set(card, "locationVersion", nextVersion);
  return nextVersion;
}

export function getEffectiveCardKinds(card: unknown): string[] {
  if (!isObjectValue(card)) return [];
  const kinds = new Set<string>();
  const cardKind = readProperty(card, "cardKind");
  const originalCardKind = readProperty(card, "originalCardKind");
  const treatedAsCardKinds = readProperty(card, "treatedAsCardKinds");
  if (typeof cardKind === "string" && cardKind) kinds.add(cardKind);
  if (typeof originalCardKind === "string" && originalCardKind) {
    kinds.add(originalCardKind);
  }
  if (Array.isArray(treatedAsCardKinds)) {
    for (const kind of treatedAsCardKinds) {
      if (kind) kinds.add(kind);
    }
  }
  return Array.from(kinds);
}

export function cardMatchesKind(
  card: unknown,
  requiredKinds: string | readonly string[] | null | undefined,
): boolean {
  if (!requiredKinds) return true;
  const required = Array.isArray(requiredKinds) ? requiredKinds : [requiredKinds];
  if (required.length === 0) return true;
  const effectiveKinds = getEffectiveCardKinds(card);
  return required.some((kind) => effectiveKinds.includes(kind));
}

export function getCardComparableAttribute(
  card: unknown,
  attribute: string | null | undefined,
): unknown {
  if (!isObjectValue(card) || !attribute) return undefined;
  if (attribute === "originalLevel") {
    const level = Number(
      readProperty(card, "baseLevel") ??
        readProperty(card, "originalLevel") ??
        readProperty(card, "level") ??
        0,
    );
    return Number.isFinite(level) ? level : 0;
  }
  return Reflect.get(card, attribute);
}

export function applyStatusesOnSummon(card: unknown, statuses: unknown): boolean {
  if (!isObjectValue(card) || !statuses) return false;
  const statusEntries = Array.isArray(statuses) ? statuses : [statuses];
  let applied = false;
  for (const entry of statusEntries) {
    if (!entry) continue;
    const status =
      typeof entry === "string"
        ? entry
        : typeof readProperty(entry, "status") === "string"
          ? String(readProperty(entry, "status"))
          : null;
    if (!status) continue;
    const value =
      isObjectValue(entry) &&
      Object.prototype.hasOwnProperty.call(entry, "value")
        ? readProperty(entry, "value")
        : true;
    if (isObjectValue(entry) && readProperty(entry, "restoreOnFieldExit") === true) {
      let fieldExitStatuses = readProperty(card, "fieldExitStatuses");
      if (!isObjectValue(fieldExitStatuses)) {
        fieldExitStatuses = {};
        Reflect.set(card, "fieldExitStatuses", fieldExitStatuses);
      }
      if (!isObjectValue(fieldExitStatuses)) continue;
      if (
        !Object.prototype.hasOwnProperty.call(fieldExitStatuses, status)
      ) {
        Reflect.set(fieldExitStatuses, status, Reflect.get(card, status));
      }
    }
    Reflect.set(card, status, value);
    applied = true;
  }
  return applied;
}

function restoreStatusRegistry(card: unknown, registryKey: string): boolean {
  if (!isObjectValue(card)) return false;
  const registry = readProperty(card, registryKey);
  if (!isObjectValue(registry)) return false;
  const statuses = Object.keys(registry);
  for (const status of statuses) {
    const previousValue = Reflect.get(registry, status);
    if (previousValue === undefined) {
      Reflect.deleteProperty(card, status);
    } else {
      Reflect.set(card, status, previousValue);
    }
  }
  Reflect.set(card, registryKey, {});
  return statuses.length > 0;
}

export function restoreTemporaryStatuses(card: unknown): boolean {
  return restoreStatusRegistry(card, "tempStatuses");
}

export function restoreFieldExitStatuses(card: unknown): boolean {
  return restoreStatusRegistry(card, "fieldExitStatuses");
}

export function captureTrapMonsterOriginalState(
  card: unknown,
): TrapMonsterOriginalState | null {
  if (!isObjectValue(card)) return null;
  const existing = readProperty(card, "trapMonsterOriginalState");
  if (isObjectValue(existing)) return existing as TrapMonsterOriginalState;

  const synchroMaterialRoles = readProperty(card, "synchroMaterialRoles");
  const types = readProperty(card, "types");
  const state: TrapMonsterOriginalState = {
    cardKind: (readProperty(card, "cardKind") || null) as CardKind | null,
    subtype: (readProperty(card, "subtype") || null) as CardSubtype | string | null,
    monsterType: (readProperty(card, "monsterType") || null) as MonsterType | null,
    isTuner: readProperty(card, "isTuner") === true,
    synchroMaterialRoles: synchroMaterialRoles
      ? cloneJsonValue(synchroMaterialRoles) as SynchroMaterialRoles
      : null,
    type: (readProperty(card, "type") || null) as MonsterRace | string | null,
    types: Array.isArray(types) ? [...types] as string[] : null,
    attribute: (readProperty(card, "attribute") || null) as CardAttribute | null,
    level: (readProperty(card, "level") ?? 0) as number,
    baseLevel: (readProperty(card, "baseLevel") ?? readProperty(card, "level") ?? 0) as number,
    baseAtk: (readProperty(card, "baseAtk") ?? 0) as number,
    baseDef: (readProperty(card, "baseDef") ?? 0) as number,
    atk: (readProperty(card, "atk") ?? 0) as number,
    def: (readProperty(card, "def") ?? 0) as number,
  };
  Reflect.set(card, "trapMonsterOriginalState", state);
  return state;
}

export function restoreTrapMonsterOriginalState(card: unknown): boolean {
  if (!isObjectValue(card) || !readProperty(card, "isTrapMonster")) return false;
  const storedOriginal = readProperty(card, "trapMonsterOriginalState");
  const original = isObjectValue(storedOriginal) ? storedOriginal : {};
  const originalSynchroRoles = readProperty(original, "synchroMaterialRoles");
  const originalTypes = readProperty(original, "types");

  Reflect.set(
    card,
    "cardKind",
    readProperty(original, "cardKind") ||
      readProperty(card, "originalCardKind") ||
      "trap",
  );
  Reflect.set(
    card,
    "subtype",
    readProperty(original, "subtype") || readProperty(card, "subtype") || null,
  );
  Reflect.set(card, "monsterType", readProperty(original, "monsterType") || null);
  Reflect.set(card, "isTuner", readProperty(original, "isTuner") === true);
  Reflect.set(card, "synchroMaterialRoles", originalSynchroRoles
    ? cloneJsonValue(originalSynchroRoles)
    : null,
  );
  Reflect.set(card, "type", readProperty(original, "type") || undefined);
  if (Array.isArray(originalTypes)) {
    Reflect.set(card, "types", [...originalTypes]);
  } else {
    Reflect.deleteProperty(card, "types");
  }
  Reflect.set(card, "attribute", readProperty(original, "attribute") || null);
  Reflect.set(card, "level", readProperty(original, "level") ?? 0);
  Reflect.set(
    card,
    "baseLevel",
    readProperty(original, "baseLevel") ?? readProperty(original, "level") ?? 0,
  );
  Reflect.set(card, "baseAtk", readProperty(original, "baseAtk") ?? 0);
  Reflect.set(card, "baseDef", readProperty(original, "baseDef") ?? 0);
  Reflect.set(card, "atk", readProperty(original, "atk") ?? 0);
  Reflect.set(card, "def", readProperty(original, "def") ?? 0);

  Reflect.deleteProperty(card, "isTrapMonster");
  Reflect.deleteProperty(card, "originalCardKind");
  Reflect.deleteProperty(card, "treatedAsCardKinds");
  Reflect.deleteProperty(card, "trapMonsterOriginalState");
  Reflect.deleteProperty(card, "trapMonsterSummonProcedure");
  return true;
}

export default class Card implements GameCard {
  declare instanceId: number;
  declare _instanceId?: number | string | null;
  declare uuid?: string | null;
  declare locationVersion: number;
  declare id: RawCardDefinitionId | CardDefinitionId | undefined;
  declare duelCardId?: DuelCardId;
  declare name: string;
  declare cardKind: CardKind;
  declare originalCardKind?: CardKind | null;
  declare treatedAsCardKinds?: CardKind[];
  declare subtype: CardSubtype | string | null;
  declare monsterType: MonsterType | null;
  declare isTuner: boolean;
  declare synchroMaterialRoles: SynchroMaterialRoles | null;
  declare archetypes: string[];
  declare archetype: string | null;
  declare baseAtk: number;
  declare baseDef: number;
  declare atk: number;
  declare def: number;
  declare type: MonsterRace | string | null | undefined;
  declare types?: string[];
  declare attribute: CardAttribute | null;
  declare level: number;
  declare baseLevel: number;
  declare originalLevel?: number | null;
  declare position: BattlePosition;
  declare previousPosition?: BattlePosition | null;
  declare positionChangedThisTurn?: boolean;
  declare revealedTurn?: number | null;
  declare isFacedown: boolean;
  declare battlePositionLocked: boolean;
  declare hasAttacked: boolean;
  declare extraAttacks: number;
  declare baseExtraAttackTargetRestriction: "monster" | null;
  declare extraAttackTargetRestriction: string | null;
  declare dynamicExtraAttacks: DynamicExtraAttacksDefinition | null;
  declare attackLimitThisTurn?: number | null;
  declare attackLimitDuration?: string | number | null;
  declare attacksUsedThisTurn: number;
  declare tempAtkBoost: number;
  declare tempDefBoost: number;
  declare cannotAttackThisTurn: boolean;
  declare cannotAttackUntilTurn: number | null;
  declare immuneToOpponentEffectsUntilTurn: number | null;
  declare altTribute: AlternateTributeDefinition | null;
  declare tributeValue:
    | TributeValueDefinition
    | readonly TributeValueDefinition[]
    | null;
  declare onBattleDestroy: string | null;
  declare canAttackDirectlyThisTurn: boolean;
  declare cannotAttackDirectly: boolean;
  declare equippedTo: Card | null;
  declare equips: Card[];
  declare equipTarget?: Card | number | string | null;
  declare summonRestrict: string | null;
  declare fieldLimit: FieldLimitDefinition | null;
  declare fieldPresenceRestriction: FieldPresenceRestriction | null;
  declare extraDeckSummonProcedure: ExtraDeckSummonProcedure | null;
  declare equipAtkBonus: number;
  declare equipDefBonus: number;
  declare equipExtraAttacks: number;
  declare grantsBattleIndestructible: boolean;
  declare battleIndestructible: boolean;
  declare tempBattleIndestructible: boolean;
  declare battleDamageHealsControllerThisTurn: boolean;
  declare preventsBattleDamageToController: boolean;
  declare battleIndestructibleOncePerTurn: boolean;
  declare battleIndestructibleOncePerTurnUsed: boolean;
  declare battleIndestructibleOncePerTurnLastUsedTurn: number | null;
  declare mustBeAttacked: boolean;
  declare piercing: boolean;
  declare piercingDamageMultiplier: number;
  declare canMakeSecondAttackThisTurn: boolean;
  declare secondAttackUsedThisTurn: boolean;
  declare dynamicBuffs: CardDynamicBuffMap | null;
  declare suppressedDynamicBuffStatsByKey?: CardSuppressedDynamicBuffStats;
  declare temporarySuppressedDynamicBuffStatsByKey?: CardSuppressedDynamicBuffStats;
  declare passiveExtraAttackBonuses?: Record<
    string,
    { amount: number; targetRestriction: string | null }
  >;
  declare passiveExtraAttackTargetRestriction?: string | null;
  declare cannotBeSpecialSummoned: boolean;
  declare cannotBeNormalSummonedOrSet: boolean;
  declare specialSummonOnlyBy: SpecialSummonProcedure[] | null;
  declare mustFirstBeSpecialSummonedBy: SpecialSummonProcedure[] | null;
  declare properSummonEstablished: boolean;
  declare properSummonProcedure: SpecialSummonProcedure | null;
  declare unaffectedByOtherCardEffects: boolean;
  declare lastSummonMethod: SummonMethod | null;
  declare lastSummonedFromZone: CanonicalZone | null;
  declare lastSummonedTurn: number | null;
  declare lastSummonProcedure: SpecialSummonProcedure | string | null;
  declare turnBasedBuffs: CardTurnBasedBuff[];
  declare tempStatuses: CardStatusRegistry;
  declare fieldExitStatuses: CardStatusRegistry;
  declare fieldPresenceId: string | number | null;
  declare fieldPresenceState: unknown;
  declare effectsNegated: boolean;
  declare effectsNegatedDuration: string | number | null;
  declare originalAtk: number | null;
  declare originalDef: number | null;
  declare counters: Map<string, number>;
  declare blueprintStorage: BlueprintStorageDefinition | null;
  declare description: string | undefined;
  declare effects: readonly EffectDefinition[];
  declare fusionMaterials: readonly FusionMaterialDefinition[] | null;
  declare ascension: AscensionDefinition | null;
  declare synchro: SynchroDefinition | null;
  declare image: string | undefined;
  declare owner: PlayerId | string;
  declare originalOwner: PlayerId | string;
  declare controller?: PlayerId | string;
  declare location?: CanonicalZone | null;
  declare zone?: CanonicalZone | null;
  declare isToken?: boolean;
  declare tokenSourceCard?: string | null;
  declare isTrapMonster?: boolean;
  declare trapMonsterOriginalState?: TrapMonsterOriginalState;
  declare trapMonsterSummonProcedure?: string;
  declare setTurn?: number | null;
  declare turnSetOn?: number | null;
  declare ascensionMaterials?: AscensionMaterialRecord[];
  declare synchroMaterials?: SynchroMaterialRecord[];
  declare enteredFieldTurn?: number | null;
  declare summonedTurn?: number | null;
  declare summonPending?: boolean;
  declare requiredTributes?: number;
  declare declaredValues?: CardDeclaredValueMap;
  declare oncePerTurnUsageByName?: EffectUsageMap;
  declare effectMarkers?: CardEffectMarkerMap;
  declare protectionEffects?: CardProtectionEffect[];
  declare permanentBuffsBySource?: CardPermanentBuffMap;
  declare linkedPermanentBuffSourceNames?: string[];
  declare originalStatsOverride?: CardOriginalStatsOverride;
  declare banishWhenLeavesField?: boolean;
  declare boundTrapSource?: Card | null;
  declare boundMonsterTarget?: Card | null;
  declare grantsCrescentShieldGuard?: boolean;
  declare lastSentToGraveAsMaterial?: SentToGraveMaterialMarker;
  declare graveyardEffectActivating?: boolean;
  declare attackedMonstersThisTurn?: Set<number | string>;
  declare canAttackAllOpponentMonstersThisTurn?: boolean;
  declare dynamicStatBoosts: CardDynamicStatBoost[];

  constructor(data: CardConstructorData, owner: PlayerId | string) {
    this.instanceId = nextCardInstanceId++;
    this.locationVersion = 0;
    this.id = data.id;
    this.name = data.name;
    this.cardKind = data.cardKind || "monster"; // monster | spell | trap
    this.subtype = data.subtype || null; // normal | quick | continuous | counter | etc
    this.monsterType = data.monsterType || null; // fusion, synchro, etc.
    this.isTuner = data.isTuner === true;
    this.synchroMaterialRoles = data.synchroMaterialRoles
      ? cloneJsonValue(data.synchroMaterialRoles)
      : null;

    // Archetypes support
    this.archetypes = Array.isArray(data.archetypes)
      ? [...data.archetypes]
      : typeof data.archetype === "string"
        ? [data.archetype]
        : [];
    this.archetype = this.archetypes[0] || null;

    this.baseAtk = data.atk ?? 0;
    this.baseDef = data.def ?? 0;
    this.atk = data.atk ?? 0;
    this.def = data.def ?? 0;
    this.type = data.type; // monster race/attribute description
    this.attribute = data.attribute || null;
    this.level = data.level ?? 0;
    this.baseLevel = data.level ?? 0;
    this.position = "attack";
    this.isFacedown = false;
    this.battlePositionLocked = false;
    this.hasAttacked = false;
    const baseExtraAttacks = Number(data.extraAttacks ?? 0);
    this.extraAttacks = Number.isFinite(baseExtraAttacks)
      ? baseExtraAttacks
      : 0;
    this.baseExtraAttackTargetRestriction =
      data.extraAttackTargetRestriction || null;
    this.extraAttackTargetRestriction = this.baseExtraAttackTargetRestriction;
    this.dynamicExtraAttacks = data.dynamicExtraAttacks
      ? cloneJsonValue(data.dynamicExtraAttacks)
      : null;
    this.attackLimitThisTurn = null;
    this.attackLimitDuration = null;
    this.attacksUsedThisTurn = 0;

    this.tempAtkBoost = 0;
    this.tempDefBoost = 0;
    this.cannotAttackThisTurn = false;
    this.cannotAttackUntilTurn = null;
    this.immuneToOpponentEffectsUntilTurn = null;
    this.altTribute = data.altTribute || null;
    this.tributeValue = data.tributeValue
      ? cloneJsonValue(data.tributeValue)
      : null;
    this.onBattleDestroy = data.onBattleDestroy || null;
    this.canAttackDirectlyThisTurn = false;
    this.cannotAttackDirectly = !!data.cannotAttackDirectly;

    // Equip support
    this.equippedTo = null;
    this.equips = [];
    this.summonRestrict = data.summonRestrict || null;
    this.fieldLimit = data.fieldLimit
      ? cloneJsonValue(data.fieldLimit)
      : null;
    this.fieldPresenceRestriction = data.fieldPresenceRestriction
      ? cloneJsonValue(data.fieldPresenceRestriction)
      : null;
    this.extraDeckSummonProcedure = data.extraDeckSummonProcedure
      ? cloneJsonValue(data.extraDeckSummonProcedure)
      : null;

    // Equip / status helpers
    this.equippedTo = this.equippedTo || null;
    this.equips = this.equips || [];

    // NOVO: controle de bônus de equipamento
    this.equipAtkBonus = 0;
    this.equipDefBonus = 0;
    this.equipExtraAttacks = 0;

    // NOVO: controle de efeitos concedidos
    this.grantsBattleIndestructible = false;

    // NOVO: status do monstro – não pode ser destruído em batalha
    this.battleIndestructible = false;
    // Status temporário: não pode ser destruído em batalha até o fim do turno
    this.tempBattleIndestructible = false;
    // Status temporário: dano de batalha sofrido envolvendo este monstro vira cura para o controlador
    this.battleDamageHealsControllerThisTurn = false;
    this.preventsBattleDamageToController =
      !!data.preventsBattleDamageToController;
    this.battleIndestructibleOncePerTurn =
      !!data.battleIndestructibleOncePerTurn;
    this.battleIndestructibleOncePerTurnUsed = false;
    const battleIndestructibleOncePerTurnLastUsedTurn = Number(
      data.battleIndestructibleOncePerTurnLastUsedTurn,
    );
    this.battleIndestructibleOncePerTurnLastUsedTurn =
      data.battleIndestructibleOncePerTurnLastUsedTurn == null ||
      !Number.isFinite(battleIndestructibleOncePerTurnLastUsedTurn)
        ? null
        : battleIndestructibleOncePerTurnLastUsedTurn;
    this.mustBeAttacked = !!data.mustBeAttacked;
    this.piercing = !!data.piercing;
    const piercingDamageMultiplier = Number(data.piercingDamageMultiplier ?? 1);
    this.piercingDamageMultiplier =
      Number.isFinite(piercingDamageMultiplier) && piercingDamageMultiplier > 0
        ? piercingDamageMultiplier
        : 1;
    this.canMakeSecondAttackThisTurn = false;
    this.secondAttackUsedThisTurn = false;
    this.dynamicBuffs = null;

    // Summon restrictions
    this.cannotBeSpecialSummoned = !!data.cannotBeSpecialSummoned;
    this.cannotBeNormalSummonedOrSet = !!data.cannotBeNormalSummonedOrSet;
    this.specialSummonOnlyBy = Array.isArray(data.specialSummonOnlyBy)
      ? [...data.specialSummonOnlyBy]
      : data.specialSummonOnlyBy
        ? [data.specialSummonOnlyBy]
        : null;
    this.mustFirstBeSpecialSummonedBy = Array.isArray(
      data.mustFirstBeSpecialSummonedBy,
    )
      ? [...data.mustFirstBeSpecialSummonedBy]
      : data.mustFirstBeSpecialSummonedBy
        ? [data.mustFirstBeSpecialSummonedBy]
        : null;
    this.properSummonEstablished = data.properSummonEstablished === true;
    this.properSummonProcedure = data.properSummonProcedure || null;
    this.unaffectedByOtherCardEffects = !!data.unaffectedByOtherCardEffects;
    this.lastSummonMethod = data.lastSummonMethod || null;
    this.lastSummonedFromZone = data.lastSummonedFromZone || null;
    this.lastSummonedTurn = data.lastSummonedTurn ?? null;
    this.lastSummonProcedure = data.lastSummonProcedure || null;

    // Turn-based temporary buffs (for expirations like "until end of next turn")
    // Structure: Array of {stat, value, expiresOnTurn, id}
    this.turnBasedBuffs = [];
    this.tempStatuses = {};
    this.fieldExitStatuses = {};

    // Field presence tracking (for mechanics like "while this card is face-up on field")
    this.fieldPresenceId = null;
    this.fieldPresenceState = null;

    // Effect negation tracking
    this.effectsNegated = data.effectsNegated === true;
    this.effectsNegatedDuration = data.effectsNegatedDuration || null;
    this.originalAtk = null; // Store original ATK when set to 0
    this.originalDef = null; // Store original DEF when set to 0

    // Counter system
    this.counters = new Map(); // counterType -> amount

    // Blueprint storage config (used by cards like Arcanist Grimoires)
    this.blueprintStorage = data.blueprintStorage
      ? cloneJsonValue(data.blueprintStorage)
      : null;

    this.description = data.description;
    this.effects = data.effects || [];
    this.fusionMaterials = data.fusionMaterials
      ? cloneJsonValue(data.fusionMaterials)
      : null;
    // Ascension metadata (Extra Deck monsters with monsterType "ascension")
    if (this.monsterType === "ascension") {
      this.ascension = data.ascension
        ? cloneJsonValue(data.ascension)
        : null;
    } else {
      this.ascension = null;
    }
    this.synchro = data.synchro
      ? cloneJsonValue(data.synchro)
      : null;
    this.image = data.image;
    this.owner = owner;
    this.originalOwner = data.originalOwner || owner;
  }

  addCounter(counterType: string, amount = 1): void {
    const current = this.counters.get(counterType) || 0;
    this.counters.set(counterType, current + amount);
  }

  removeCounter(counterType: string, amount = 1): void {
    const current = this.counters.get(counterType) || 0;
    const newAmount = Math.max(0, current - amount);
    if (newAmount === 0) {
      this.counters.delete(counterType);
    } else {
      this.counters.set(counterType, newAmount);
    }
  }

  getCounter(counterType: string): number {
    return this.counters.get(counterType) || 0;
  }

  hasCounter(counterType: string): boolean {
    return this.counters.has(counterType) && (this.counters.get(counterType) ?? 0) > 0;
  }

  /**
   * Calcula o ATK/DEF total incluindo boosts dinâmicos.
   * @param {string} stat - 'atk' ou 'def'
   * @param game - Referência ao Game para acessar estado
   * @returns {number}
   */
  calculateDynamicStat(stat: "atk" | "def", game: unknown): number {
    if (!game || this.cardKind !== "monster") return this[stat] || 0;

    let base = this[stat] || 0;

    // Aplicar dynamic stat boosts
    for (const boost of this.dynamicStatBoosts) {
      if (boost.stat !== stat) continue;

      const { formula } = boost;
      let boostValue = 0;

      switch (formula.type) {
        case "count_gy_archetype": {
          // Contar monstros de um arquétipo no cemitério do dono
          const graveyard = readProperty(this.owner, "graveyard");
          if (!Array.isArray(graveyard)) break;

          const count = graveyard.filter((card) => {
            if (!isObjectValue(card) || readProperty(card, "cardKind") !== "monster") return false;
            if (formula.archetype) {
              const archetypes = readProperty(card, "archetypes");
              return (
                readProperty(card, "archetype") === formula.archetype ||
                (Array.isArray(archetypes) && archetypes.includes(formula.archetype))
              );
            }
            return true;
          }).length;

          boostValue = count * (formula.perCard || 0);
          break;
        }

        case "count_field_archetype": {
          // Contar monstros de um arquétipo no campo do dono
          const field = readProperty(this.owner, "field");
          if (!Array.isArray(field)) break;

          const count = field.filter((card) => {
            if (!isObjectValue(card) || readProperty(card, "cardKind") !== "monster") return false;
            if (readProperty(card, "id") === this.id) return false; // Excluir a si mesmo
            if (formula.archetype) {
              const archetypes = readProperty(card, "archetypes");
              return (
                readProperty(card, "archetype") === formula.archetype ||
                (Array.isArray(archetypes) && archetypes.includes(formula.archetype))
              );
            }
            return true;
          }).length;

          boostValue = count * (formula.perCard || 0);
          break;
        }

        case "fixed": {
          // Boost fixo
          boostValue = formula.value || 0;
          break;
        }

        default:
          console.warn(
            `[Card.calculateDynamicStat] Unknown formula type: ${formula.type}`,
          );
      }

      base += boostValue;
    }

    return base;
  }
}
