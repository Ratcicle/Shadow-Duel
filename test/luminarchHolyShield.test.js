import test from "node:test";
import assert from "node:assert/strict";

import EffectEngine from "../src/core/EffectEngine.js";
import { restoreTemporaryStatuses } from "../src/core/Card.js";
import { canDestroyByBattle } from "../src/core/game/combat/availability.js";
import { finishCombat } from "../src/core/game/combat/resolution.js";
import { luminarchCards } from "../src/data/cards/luminarch.js";

const holyShield = luminarchCards.find(
  (card) => card.name === "Luminarch Holy Shield",
);
const holyShieldEffect = holyShield.effects[0];

function monster(name, owner, values = {}) {
  return {
    name,
    cardKind: "monster",
    archetype: owner === "player" ? "Luminarch" : null,
    owner,
    position: "attack",
    atk: 1000,
    def: 1000,
    isFacedown: false,
    tempBattleIndestructible: false,
    battleDamageHealsControllerThisTurn: false,
    tempStatuses: {},
    ...values,
  };
}

function player(id, field = []) {
  return {
    id,
    name: id,
    controllerType: id === "bot" ? "ai" : "human",
    lp: 4000,
    field,
    hand: [],
    spellTrap: [],
    graveyard: [],
    banished: [],
    gainLP(amount) {
      this.lp += amount;
    },
  };
}

function effectHarness(ownField = [], opposingField = []) {
  const own = player("player", ownField);
  const opponent = player("bot", opposingField);
  const logs = [];
  const game = {
    player: own,
    bot: opponent,
    turn: "player",
    turnCounter: 3,
    ui: { log: (message) => logs.push(message) },
    getOpponent: (owner) => (owner === own ? opponent : own),
    getZone: (owner, zone) => owner?.[zone] || [],
    updateBoard() {},
  };
  const engine = new EffectEngine(game);
  game.effectEngine = engine;
  return { engine, game, own, opponent, logs };
}

test("Holy Shield aplica apenas status temporário a alvos ainda válidos", async () => {
  assert.equal(
    holyShieldEffect.actions.every((action) => action.untilEndOfTurn === true),
    true,
  );

  const valid = monster("Valid Luminarch", "player");
  const removed = monster("Removed Luminarch", "player");
  const { engine, own, opponent } = effectHarness([valid], []);
  own.graveyard.push(removed);

  const validResult = await engine.applyActions(
    holyShieldEffect.actions,
    { source: holyShield, effect: holyShieldEffect, player: own, opponent },
    { holy_shield_targets: [valid] },
  );
  assert.equal(validResult.success, true);
  assert.equal(valid.tempBattleIndestructible, true);
  assert.equal(valid.battleDamageHealsControllerThisTurn, true);

  restoreTemporaryStatuses(valid);
  assert.equal(valid.tempBattleIndestructible, false);
  assert.equal(valid.battleDamageHealsControllerThisTurn, false);

  const removedResult = await engine.applyActions(
    holyShieldEffect.actions,
    { source: holyShield, effect: holyShieldEffect, player: own, opponent },
    { holy_shield_targets: [removed] },
  );
  assert.equal(removedResult.success, false);
  assert.equal(removed.tempBattleIndestructible, false);
  assert.equal(removed.battleDamageHealsControllerThisTurn, false);
});

test("Holy Shield converte dano em LP sem registrar dano ou destruição", async () => {
  const target = monster("Shield Target", "player", {
    tempBattleIndestructible: true,
    battleDamageHealsControllerThisTurn: true,
  });
  const attacker = monster("Attacker", "bot", { atk: 2500 });
  const { game, own, opponent, logs } = effectHarness([target], [attacker]);
  const events = [];
  let destroyCalls = 0;
  Object.assign(game, {
    markAttackUsed() {},
    clearAttackResolutionIndicators() {},
    checkWinCondition() {},
    canDestroyByBattle(card, context) {
      return canDestroyByBattle.call(this, card, context);
    },
    async destroyCard() {
      destroyCalls += 1;
      return { destroyed: true };
    },
    async applyBattleDestroyEffect() {
      return { ok: true };
    },
    inflictDamage(affected, amount) {
      affected.lp -= amount;
    },
    async emit(eventName, payload) {
      events.push({ eventName, payload });
      return { ok: true };
    },
  });

  const result = await finishCombat.call(game, attacker, target, {
    resumeFromTie: true,
  });
  const battleCompleted = events.find(
    (event) => event.eventName === "battle_completed",
  );

  assert.equal(own.lp, 5500);
  assert.equal(opponent.lp, 4000);
  assert.equal(destroyCalls, 0);
  assert.equal(result.damageDealt, 0);
  assert.equal(result.targetDestroyed, false);
  assert.equal(battleCompleted.payload.damageDealt, 0);
  assert.ok(logs.some((message) => /gained 1500 LP instead/.test(message)));
  assert.equal(logs.some((message) => /destroyed Shield Target/.test(message)), false);
  assert.equal(logs.some((message) => /dealt 1500 damage/.test(message)), false);
});

test("combate sem Holy Shield continua registrando o dano realmente causado", async () => {
  const target = monster("Unprotected Target", "player");
  const attacker = monster("Attacker", "bot", { atk: 2500 });
  const { game, own } = effectHarness([target], [attacker]);
  const events = [];
  Object.assign(game, {
    markAttackUsed() {},
    clearAttackResolutionIndicators() {},
    checkWinCondition() {},
    canDestroyByBattle(card, context) {
      return canDestroyByBattle.call(this, card, context);
    },
    async destroyCard(card) {
      own.field = own.field.filter((entry) => entry !== card);
      return { destroyed: true };
    },
    async applyBattleDestroyEffect() {
      return { ok: true };
    },
    inflictDamage(affected, amount) {
      affected.lp = Math.max(0, affected.lp - amount);
    },
    async emit(eventName, payload) {
      events.push({ eventName, payload });
      return { ok: true };
    },
  });

  const result = await finishCombat.call(game, attacker, target, {
    resumeFromTie: true,
  });
  const battleCompleted = events.find(
    (event) => event.eventName === "battle_completed",
  );

  assert.equal(own.lp, 2500);
  assert.equal(result.damageDealt, 1500);
  assert.equal(result.targetDestroyed, true);
  assert.equal(battleCompleted.payload.damageDealt, 1500);
});
