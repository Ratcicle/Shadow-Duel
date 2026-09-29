import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { cardDatabaseByName, required } from "./helpers/fixtures.js";
import { createRuntimeGame, type RuntimeGame } from "./helpers/game.js";
import { hashCanonicalGameState } from "../src/core/game/replay/canonical.js";
import type { ReplayDecisionInput } from "../src/core/contracts/decisions.js";

function makeGame() {
  const game = createRuntimeGame({ disableChains: true, randomSeed: 81, getFieldPlacementMode: () => "manual", fieldPlacementProvider: async () => ({ outcome: "chosen", slot: 4 }), laboratoryMode: true, laboratoryUseBot: false });
  game.phaseDelayMs = 0;
  game.turnCounter = 3;
  game.applyScenarioSetup({ schemaVersion: 2, turn: "player", phase: "main1",
    player: { hand: [{ id: 104 }], field: [{ id: 125, fieldSlot: 2 }], spellTrap: [{ id: 126, fieldSlot: 1, facedown: true, turnSetOn: 1 }], graveyard: [{ id: 104 }, { id: 104 }, { id: 122 }, { id: 107 }, { id: 1 }] },
    bot: { hand: [], field: [], spellTrap: [] },
  }, { immediateActions: true });
  return game;
}

async function select(game: RuntimeGame, indices: number[]) {
  for (let i = 0; i < 100 && !game.targetSelection; i++) await new Promise<void>(resolve => setTimeout(resolve, 10));
  const session = required(game.targetSelection);
  const requirement = required(session.requirements[0]);
  session.selections[requirement.id] = indices.map(index => required(requirement.candidates[index]).key);
  await game.finishTargetSelection();
}

test("humans choose the monster, Tributes and recovery; broker playback preserves the state hash", async (t) => {
  const live = makeGame();
  const playback = createRuntimeGame({ disableChains: true, randomSeed: 81, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false });
  t.after(() => { live.dispose(); playback.dispose(); });
  const decisions: ReplayDecisionInput[] = [];
  live.on("decision_made", decision => { decisions.push(decision); });
  live.ui.showTrapActivationModal = async () => true;
  playback.ui.showTrapActivationModal = async () => true;
  const source = required(live.player.spellTrap[0]);
  const activation = live.tryActivateSpellTrapEffect(source);
  await select(live, [0]);
  assert.equal(live.player.graveyard.some(c => c.id === 125), false, "no Tributes paid before the human chooses");
  await select(live, [0]);
  assert.equal((await activation).success, true);
  assert.equal(live.player.field[0]?.id, 104);
  assert.equal(live.player.summonCount, 1);
  const recovery = live.tryActivateSpellTrapEffect(source, null, { activationZone: "graveyard" });
  await select(live, [0, 1]);
  assert.equal((await recovery).success, true);
  assert.equal(live.player.hand.filter(c => c.id === 104).length, 2);
  assert.ok(live.player.banished.includes(source));
  assert.equal(decisions.filter(d => d.kind !== "field_placement").length, 4);

  playback.turnCounter = 3;
  playback.applyScenarioSetup({ schemaVersion: 2, turn: "player", phase: "main1",
    player: { hand: [{ id: 104 }], field: [{ id: 125, fieldSlot: 2 }], spellTrap: [{ id: 126, fieldSlot: 1, facedown: true, turnSetOn: 1 }], graveyard: [{ id: 104 }, { id: 104 }, { id: 122 }, { id: 107 }, { id: 1 }] },
    bot: { hand: [], field: [], spellTrap: [] },
  }, { immediateActions: true });
  playback.decisionBroker.loadReplayDecisions(decisions);
  const replaySource = required(playback.player.spellTrap[0]);
  assert.equal((await playback.tryActivateSpellTrapEffect(replaySource)).success, true);
  assert.equal((await playback.tryActivateSpellTrapEffect(replaySource, null, { activationZone: "graveyard" })).success, true);
  assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
  assert.equal(playback.decisionBroker.replayCursor, decisions.length);
});

test("recovery requires own Main Phase and eligible monsters; Fusion returns to Extra Deck", async (t) => {
  const game = makeGame();
  t.after(() => game.dispose());
  game.player.controllerType = "ai";
  const source = required(game.player.spellTrap.pop());
  source.isFacedown = false;
  game.player.graveyard = [source, ...game.player.graveyard.filter(c => c.id === 107 || c.id === 1)];
  const preview = () => game.effectEngine.canActivateSpellTrapEffectPreview(source, game.player, "graveyard");
  assert.equal(preview().ok, false);
  const fusion = new Card(required(cardDatabaseByName.get("Shadow-Heart Warlord")), "player");
  game.player.graveyard.push(fusion);
  game.turn = "bot";
  assert.equal(preview().ok, false);
  game.turn = "player";
  game.phase = "battle";
  assert.equal(preview().ok, false);
  game.phase = "main2";
  assert.equal(preview().ok, true);
  assert.equal((await game.tryActivateSpellTrapEffect(source, null, { activationZone: "graveyard" })).success, true);
  assert.ok(game.player.extraDeck.includes(fusion));
  assert.equal(game.player.hand.includes(fusion), false);
});

test("normal allowances and temporary grants reset for both players on every new turn", async (t) => {
  const game = makeGame();
  t.after(() => game.dispose());
  game.player.spellTrap = [];
  game.player.field = [];
  for (const player of [game.player, game.bot]) {
    player.controllerType = "human";
    player.deck = Array.from({ length: 10 }, () => new Card({ name: "Draw card", cardKind: "spell" }, player.id));
  }
  for (const turn of ["player", "bot", "player"] as const) {
    for (const player of [game.player, game.bot]) {
      player.summonCount = 1;
      player.normalSummonsThisTurn = [{ unknown: true }];
      player.additionalNormalSummons = 1;
      player.additionalNormalSummonPermissions = [{ count: 1, filters: { archetype: "Shadow-Heart" } }];
    }
    game.turn = turn;
    await game.startTurn();
    for (const player of [game.player, game.bot]) {
      assert.equal(player.summonCount, 0);
      assert.deepEqual(player.normalSummonsThisTurn, []);
      assert.equal(player.additionalNormalSummons, 0);
      assert.deepEqual(player.additionalNormalSummonPermissions, []);
    }
  }
});
