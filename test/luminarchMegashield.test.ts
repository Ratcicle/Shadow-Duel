import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import test from "node:test";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { required } from "./helpers/fixtures.js";
import type { RuntimeGame } from "./helpers/game.js";
import { createRuntimeGame } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";

import Card from "../src/core/Card.js";
import { applySwitchPosition } from "../src/core/ai/common/simulatedActions/stats.js";
import { cardDatabaseByName } from "./helpers/fixtures.js";

function createGame(t: TestContext) {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,
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

function placeMegashield(game: RuntimeGame) {
  const card = new Card(
    required(cardDatabaseByName.get("Luminarch Megashield Barbarias")),
    game.player.id,
  );
  card.summonedTurn = 1;
  card.position = "attack";
  game.player.field.push(card);
  return card;
}

async function activateStanceEffect(game: RuntimeGame, card: Card) {
  return await game.tryActivateMonsterEffect(card, null, "field", game.player, {
    effectId: "megashield_barbarias_switch_boost",
  });
}

test("Megaescudo pode atacar após ir manualmente para Defesa e voltar por efeito", async (t) => {
  const game = createGame(t);
  const megashield = placeMegashield(game);

  const manualChange = await game.changeMonsterPosition(megashield, "defense");
  assert.ok(manualChange.ok === true);
  assert.equal(megashield.position, "defense");
  assert.equal(megashield.cannotAttackThisTurn, false);

  const activation = await activateStanceEffect(game, megashield);
  assert.ok(activation.ok === true);
  assert.equal(megashield.position, "attack");
  assert.equal(megashield.atk, 3300);
  assert.equal(megashield.cannotAttackThisTurn, false);

  game.phase = "battle";
  game.battleStep = "battle";
  assert.ok(game.getAttackAvailability(megashield).ok === true);
});

test("mudança de posição não remove uma restrição real de ataque", async (t) => {
  const game = createGame(t);
  const megashield = placeMegashield(game);
  megashield.position = "defense";
  megashield.cannotAttackThisTurn = true;

  const activation = await activateStanceEffect(game, megashield);
  assert.ok(activation.ok === true);
  assert.equal(megashield.position, "attack");
  assert.equal(megashield.cannotAttackThisTurn, true);

  game.phase = "battle";
  game.battleStep = "battle";
  assert.ok(game.getAttackAvailability(megashield).ok === false);
});

test("simulação separa posição de batalha de restrição de ataque", () => {
  const unrestricted = simulationCard({
    cardKind: "monster",
    name: "Unrestricted",
    position: "attack",
    cannotAttackThisTurn: false,
  });
  const restricted = simulationCard({
    cardKind: "monster",
    name: "Restricted",
    position: "defense",
    cannotAttackThisTurn: true,
  });
  const self = { id: "bot" as const, field: [unrestricted, restricted] };
  const opponent = { id: "player" as const, field: [] };
  const state = simulationState({ bot: self, player: opponent });
  const baseContext = {
    action: { type: "switch_position" as const, markChanged: true },
    state,
    options: {},
    selfId: "bot",
    applySimulatedActions,
    self: state.bot,
    opponent: state.player,
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

// Migration parity: retain the existing functional bug for a separate fix.
test("Sacred Judgment resource planning preserves the legacy unresolved field lookup", async () => {
  const { shouldCommitResourcesNow } = await import(
    "../src/core/ai/luminarch/multiTurnPlanning.js"
  );
  assert.throws(
    () =>
      shouldCommitResourcesNow(
        simulationCard({ name: "Luminarch Sacred Judgment" }),
        { field: [], lp: 8000, oppField: [] },
        { stance: "balanced" },
      ),
    { name: "ReferenceError", message: "field is not defined" },
  );
});
