export default class Card {
  constructor(data, owner) {
    this.id = data.id;
    this.name = data.name;
    this.cardKind = data.cardKind || "monster"; // monster | spell | trap
    this.subtype = data.subtype || null; // normal | quick | continuous | counter | etc

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
    this.level = data.level ?? 0;
    this.position = "attack";
    this.isFacedown = false;
    this.hasAttacked = false;
    this.extraAttacks = 0;
    this.attacksUsedThisTurn = 0;

    this.tempAtkBoost = 0;
    this.tempDefBoost = 0;
    this.cannotAttackThisTurn = false;
    this.altTribute = data.altTribute || null;
    this.onBattleDestroy = data.onBattleDestroy || null;

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

    this.description = data.description;
    this.effects = data.effects || [];
    this.image = data.image;
    this.owner = owner;
  }
}
