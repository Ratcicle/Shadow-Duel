import assert from "node:assert/strict";
import test from "node:test";

import Card from "../src/core/Card.js";
import Game from "../src/core/Game.js";
import { applySwitchPosition } from "../src/core/ai/common/simulatedActions/stats.js";
import { cardDatabaseByName } from "../src/data/cards.js";

function createGame(t) {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
    phaseDelayMs: 0,
    animationDelayMs: 0,
  });
  game.turn = game.player.id;
  game.turnCounter = 2;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose("luminarch_megashield_test_complete"));
  return game;
}

function placeMegashield(game) {
  const card = new Card(
    cardDatabaseByName.get("Luminarch Megashield Barbarias"),
    game.player.id,
  );
  card.summonedTurn = 1;
  card.position = "attack";
  game.player.field.push(card);
  return card;
}

async function activateStanceEffect(game, card) {
  return await game.tryActivateMonsterEffect(
    card,
    null,
    "field",
    game.player,
    { effectId: "megashield_barbarias_switch_boost" },
  );
}

test("Megaescudo pode atacar após ir manualmente para Defesa e voltar por efeito", async (t) => {
  const game = createGame(t);
  const megashield = placeMegashield(game);

  const manualChange = await game.changeMonsterPosition(megashield, "defense");
  assert.equal(manualChange.ok, true);
  assert.equal(megashield.position, "defense");
  assert.equal(megashield.cannotAttackThisTurn, false);

  const activation = await activateStanceEffect(game, megashield);
  assert.equal(activation.ok, true);
  assert.equal(megashield.position, "attack");
  assert.equal(megashield.atk, 3300);
  assert.equal(megashield.cannotAttackThisTurn, false);

  game.phase = "battle";
  game.battleStep = "battle";
  assert.equal(game.getAttackAvailability(megashield).ok, true);
});

test("mudança de posição não remove uma restrição real de ataque", async (t) => {
  const game = createGame(t);
  const megashield = placeMegashield(game);
  megashield.position = "defense";
  megashield.cannotAttackThisTurn = true;

  const activation = await activateStanceEffect(game, megashield);
  assert.equal(activation.ok, true);
  assert.equal(megashield.position, "attack");
  assert.equal(megashield.cannotAttackThisTurn, true);

  game.phase = "battle";
  game.battleStep = "battle";
  assert.equal(game.getAttackAvailability(megashield).ok, false);
});

test("simulação separa posição de batalha de restrição de ataque", () => {
  const unrestricted = {
    cardKind: "monster",
    name: "Unrestricted",
    position: "attack",
    cannotAttackThisTurn: false,
  };
  const restricted = {
    cardKind: "monster",
    name: "Restricted",
    position: "defense",
    cannotAttackThisTurn: true,
  };
  const self = { id: "bot", field: [unrestricted, restricted] };
  const opponent = { id: "player", field: [] };
  const state = { bot: self, player: opponent };
  const baseContext = {
    action: { type: "switch_position", markChanged: true },
    state,
    options: {},
    self,
    opponent,
  };

  applySwitchPosition({ ...baseContext, targets: [unrestricted] });
  assert.equal(unrestricted.position, "defense");
  assert.equal(unrestricted.cannotAttackThisTurn, false);

  applySwitchPosition({ ...baseContext, targets: [unrestricted, restricted] });
  assert.equal(unrestricted.position, "attack");
  assert.equal(unrestricted.cannotAttackThisTurn, false);
  assert.equal(restricted.position, "attack");
  assert.equal(restricted.cannotAttackThisTurn, true);
});
