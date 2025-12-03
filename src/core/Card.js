export default class Card {
  constructor(data, owner) {
    this.id = data.id;
    this.name = data.name;
    this.cardKind = data.cardKind || "monster"; // monster | spell | trap
    this.subtype = data.subtype || null; // normal | quick | continuous | counter | etc

    this.atk = data.atk ?? 0;
    this.def = data.def ?? 0;
    this.type = data.type; // monster race/attribute description
    this.level = data.level ?? 0;
    this.position = "attack";
    this.isFacedown = false;
    this.hasAttacked = false;

    this.tempAtkBoost = 0;
    this.altTribute = data.altTribute || null;
    this.onBattleDestroy = data.onBattleDestroy || null;
    this.summonRestrict = data.summonRestrict || null;

    this.description = data.description;
    this.effects = data.effects || [];
    this.image = data.image;
    this.owner = owner;
  }
}
