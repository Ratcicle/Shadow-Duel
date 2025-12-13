export default class Card {
  constructor(data, owner) {
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

    this.atk = data.atk ?? 0;
    this.def = data.def ?? 0;
    this.type = data.type; // monster race/attribute description
    this.attribute = data.attribute || null;
    this.level = data.level ?? 0;
    this.position = "attack";
    this.isFacedown = false;
    this.hasAttacked = false;
    const baseExtraAttacks = Number(data.extraAttacks ?? 0);
    this.extraAttacks = Number.isFinite(baseExtraAttacks) ? baseExtraAttacks : 0;
    this.attacksUsedThisTurn = 0;

    this.tempAtkBoost = 0;
    this.tempDefBoost = 0;
    this.cannotAttackThisTurn = false;
    this.cannotAttackUntilTurn = null;
    this.immuneToOpponentEffectsUntilTurn = null;
    this.altTribute = data.altTribute || null;
    this.onBattleDestroy = data.onBattleDestroy || null;
    this.canAttackDirectlyThisTurn = false;

    // Equip support
    this.equippedTo = null;
    this.equips = [];
    this.summonRestrict = data.summonRestrict || null;

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
    this.battleIndestructibleOncePerTurn =
      !!data.battleIndestructibleOncePerTurn;
    this.battleIndestructibleOncePerTurnUsed = false;
    this.mustBeAttacked = !!data.mustBeAttacked;
    this.piercing = !!data.piercing;
    this.canMakeSecondAttackThisTurn = false;
    this.secondAttackUsedThisTurn = false;
    this.voidTenebrisBuffValue = 0;

    // Effect negation tracking
    this.effectsNegated = false;
    this.originalAtk = null; // Store original ATK when set to 0
    this.originalDef = null; // Store original DEF when set to 0

    // Counter system
    this.counters = new Map(); // counterType -> amount

    this.description = data.description;
    this.effects = data.effects || [];
    this.fusionMaterials = data.fusionMaterials
      ? JSON.parse(JSON.stringify(data.fusionMaterials))
      : null;
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
}
