let nextCardInstanceId = 1;

export function getEffectiveCardKinds(card) {
  if (!card) return [];
  const kinds = new Set();
  if (card.cardKind) kinds.add(card.cardKind);
  if (card.originalCardKind) kinds.add(card.originalCardKind);
  if (Array.isArray(card.treatedAsCardKinds)) {
    for (const kind of card.treatedAsCardKinds) {
      if (kind) kinds.add(kind);
    }
  }
  return Array.from(kinds);
}

export function cardMatchesKind(card, requiredKinds) {
  if (!requiredKinds) return true;
  const required = Array.isArray(requiredKinds) ? requiredKinds : [requiredKinds];
  if (required.length === 0) return true;
  const effectiveKinds = getEffectiveCardKinds(card);
  return required.some((kind) => effectiveKinds.includes(kind));
}

export function captureTrapMonsterOriginalState(card) {
  if (!card) return null;
  if (card.trapMonsterOriginalState) return card.trapMonsterOriginalState;

  card.trapMonsterOriginalState = {
    cardKind: card.cardKind || null,
    subtype: card.subtype || null,
    monsterType: card.monsterType || null,
    type: card.type || null,
    types: Array.isArray(card.types) ? [...card.types] : null,
    attribute: card.attribute || null,
    level: card.level ?? 0,
    baseAtk: card.baseAtk ?? 0,
    baseDef: card.baseDef ?? 0,
    atk: card.atk ?? 0,
    def: card.def ?? 0,
  };
  return card.trapMonsterOriginalState;
}

export function restoreTrapMonsterOriginalState(card) {
  if (!card || !card.isTrapMonster) return false;
  const original = card.trapMonsterOriginalState || {};

  card.cardKind = original.cardKind || card.originalCardKind || "trap";
  card.subtype = original.subtype || card.subtype || null;
  card.monsterType = original.monsterType || null;
  card.type = original.type || undefined;
  if (Array.isArray(original.types)) {
    card.types = [...original.types];
  } else {
    delete card.types;
  }
  card.attribute = original.attribute || null;
  card.level = original.level ?? 0;
  card.baseAtk = original.baseAtk ?? 0;
  card.baseDef = original.baseDef ?? 0;
  card.atk = original.atk ?? 0;
  card.def = original.def ?? 0;

  delete card.isTrapMonster;
  delete card.originalCardKind;
  delete card.treatedAsCardKinds;
  delete card.trapMonsterOriginalState;
  delete card.trapMonsterSummonProcedure;
  return true;
}

export default class Card {
  constructor(data, owner) {
    this.instanceId = nextCardInstanceId++;
    this.id = data.id;
    this.name = data.name;
    this.cardKind = data.cardKind || "monster"; // monster | spell | trap
    this.subtype = data.subtype || null; // normal | quick | continuous | counter | etc
    this.monsterType = data.monsterType || null; // fusion, synchro, etc.

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
    this.position = "attack";
    this.isFacedown = false;
    this.hasAttacked = false;
    const baseExtraAttacks = Number(data.extraAttacks ?? 0);
    this.extraAttacks = Number.isFinite(baseExtraAttacks)
      ? baseExtraAttacks
      : 0;
    this.extraAttackTargetRestriction =
      data.extraAttackTargetRestriction || null;
    this.dynamicExtraAttacks = data.dynamicExtraAttacks
      ? JSON.parse(JSON.stringify(data.dynamicExtraAttacks))
      : null;
    this.attacksUsedThisTurn = 0;

    this.tempAtkBoost = 0;
    this.tempDefBoost = 0;
    this.cannotAttackThisTurn = false;
    this.cannotAttackUntilTurn = null;
    this.immuneToOpponentEffectsUntilTurn = null;
    this.altTribute = data.altTribute || null;
    this.tributeValue = data.tributeValue
      ? JSON.parse(JSON.stringify(data.tributeValue))
      : null;
    this.onBattleDestroy = data.onBattleDestroy || null;
    this.canAttackDirectlyThisTurn = false;
    this.cannotAttackDirectly = !!data.cannotAttackDirectly;

    // Equip support
    this.equippedTo = null;
    this.equips = [];
    this.summonRestrict = data.summonRestrict || null;
    this.fieldLimit = data.fieldLimit
      ? JSON.parse(JSON.stringify(data.fieldLimit))
      : null;
    this.fieldPresenceRestriction = data.fieldPresenceRestriction
      ? JSON.parse(JSON.stringify(data.fieldPresenceRestriction))
      : null;
    this.extraDeckSummonProcedure = data.extraDeckSummonProcedure
      ? JSON.parse(JSON.stringify(data.extraDeckSummonProcedure))
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
    this.unaffectedByOtherCardEffects = !!data.unaffectedByOtherCardEffects;
    this.lastSummonMethod = null;
    this.lastSummonedFromZone = null;
    this.lastSummonedTurn = null;
    this.lastSummonProcedure = null;

    // Turn-based temporary buffs (for expirations like "until end of next turn")
    // Structure: Array of {stat, value, expiresOnTurn, id}
    this.turnBasedBuffs = [];
    this.tempStatuses = {};

    // Field presence tracking (for mechanics like "while this card is face-up on field")
    this.fieldPresenceId = null;
    this.fieldPresenceState = null;

    // Effect negation tracking
    this.effectsNegated = false;
    this.originalAtk = null; // Store original ATK when set to 0
    this.originalDef = null; // Store original DEF when set to 0

    // Counter system
    this.counters = new Map(); // counterType -> amount

    // Blueprint storage config (used by cards like Arcanist Grimoires)
    this.blueprintStorage = data.blueprintStorage
      ? JSON.parse(JSON.stringify(data.blueprintStorage))
      : null;

    this.description = data.description;
    this.effects = data.effects || [];
    this.fusionMaterials = data.fusionMaterials
      ? JSON.parse(JSON.stringify(data.fusionMaterials))
      : null;
    // Ascension metadata (Extra Deck monsters with monsterType "ascension")
    if (this.monsterType === "ascension") {
      this.ascension = data.ascension
        ? JSON.parse(JSON.stringify(data.ascension))
        : null;
    } else {
      this.ascension = null;
    }
    this.image = data.image;
    this.owner = owner;
  }

  addCounter(counterType, amount = 1) {
    const current = this.counters.get(counterType) || 0;
    this.counters.set(counterType, current + amount);
  }

  removeCounter(counterType, amount = 1) {
    const current = this.counters.get(counterType) || 0;
    const newAmount = Math.max(0, current - amount);
    if (newAmount === 0) {
      this.counters.delete(counterType);
    } else {
      this.counters.set(counterType, newAmount);
    }
  }

  getCounter(counterType) {
    return this.counters.get(counterType) || 0;
  }

  hasCounter(counterType) {
    return this.counters.has(counterType) && this.counters.get(counterType) > 0;
  }

  /**
   * Calcula o ATK/DEF total incluindo boosts dinâmicos.
   * @param {string} stat - 'atk' ou 'def'
   * @param {Object} game - Referência ao Game para acessar estado
   * @returns {number}
   */
  calculateDynamicStat(stat, game) {
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
          const owner = this.owner;
          if (!owner || !owner.graveyard) break;

          const count = owner.graveyard.filter((c) => {
            if (!c || c.cardKind !== "monster") return false;
            if (formula.archetype) {
              return (
                c.archetype === formula.archetype ||
                (c.archetypes && c.archetypes.includes(formula.archetype))
              );
            }
            return true;
          }).length;

          boostValue = count * (formula.perCard || 0);
          break;
        }

        case "count_field_archetype": {
          // Contar monstros de um arquétipo no campo do dono
          const owner = this.owner;
          if (!owner || !owner.field) break;

          const count = owner.field.filter((c) => {
            if (!c || c.cardKind !== "monster") return false;
            if (c.id === this.id) return false; // Excluir a si mesmo
            if (formula.archetype) {
              return (
                c.archetype === formula.archetype ||
                (c.archetypes && c.archetypes.includes(formula.archetype))
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
