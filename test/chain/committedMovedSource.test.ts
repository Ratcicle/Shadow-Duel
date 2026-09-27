import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import type { ActivationRuntimeContext } from "../../src/core/effects/activation/runtime.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, runtimeCard } from "../helpers/game.js";

function scenario(t: TestContext, actor: "player" | "bot") {
  const first = new Bot("techzero"); first.id = "player";
  const second = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies Player runtime and clone capabilities");
  t.after(() => game.dispose("committed_moved_source_test"));
  game.turn = actor; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
  const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Concrete Game supplies attached Bot runtime and snapshot boundaries");
  first.game = botGame; second.game = botGame;
  const bot = actor === "player" ? first : second;
  const other = actor === "player" ? second : first;
  return { game, botGame, bot, other };
}

for (const actor of ["player", "bot"] as const) {
  test(`controlled Reactor completes its activation after its cost returns it to the original owner's graveyard (${actor})`, async t => {
    const { game, botGame, bot, other } = scenario(t, actor);
    const reactor = new Card(cardDefinition(515), other.id);
    reactor.summonedTurn = 2;
    placeFieldCards(other.field, reactor);
    assert.equal((await game.takeControl(reactor, bot, { duration: "until_end_phase" })).success, true);
    assert.ok(bot.field.includes(reactor));
    const ghost = new Card(cardDefinition(511), bot.id);
    ghost.properSummonEstablished = true; ghost.properSummonProcedure = "synchro";
    bot.graveyard.push(ghost);
    for (const player of [bot, other]) placeFieldCards(player.spellTrap, new Card(cardDefinition(17), player.id));
    const action = required(bot.generateMainPhaseActions(botGame).find(candidate => candidate.type === "monsterEffect" && candidate.cardId === 515));
    const state = bot.cloneGameState(botGame);
    assert.equal(required(state.bot.field[0]).originalOwner, other.id);
    bot.simulateMainPhaseAction(state, action);

    assert.equal(await bot.executeMainPhaseAction(botGame, action), true);
    assert.deepEqual(bot.field.map(card => card.id), [511]);
    assert.deepEqual(bot.graveyard, []);
    assert.deepEqual(other.graveyard, [reactor]);
    assert.equal(reactor.owner, other.id);
    assert.equal(ghost.owner, bot.id);
    assert.deepEqual(state.bot.field.map(card => card.id), [511]);
    assert.deepEqual(state.bot.graveyard, []);
    assert.deepEqual(state.player.graveyard.map(card => card.id), [515]);
    for (const player of [bot, other]) assert.equal(required(player.spellTrap[0]).getCounter("funeral"), 1);
    for (const player of [state.bot, state.player]) assert.equal(required(player.spellTrap[0]).counters?.get("funeral"), 1);
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  for (const kind of ["monster", "spell"] as const) {
    test(`a committed moved ${kind} keeps the activation controller after owner normalization (${actor})`, async t => {
      const { game, bot, other } = scenario(t, actor);
      const source = runtimeCard({ cardKind: kind, subtype: kind === "spell" ? "continuous" : null,
        effects: [{ id: "moved_source_effect", timing: "ignition", activationZones: [kind === "spell" ? "spellTrap" : "field"], actions: [{ type: "damage", player: "opponent", amount: 300 }] }] }, bot.id);
      source.originalOwner = other.id;
      const zone = kind === "spell" ? "spellTrap" : "field";
      placeFieldCards(bot[zone], source);
      const sourceAtActivation: NonNullable<ActivationRuntimeContext["sourceAtActivation"]> = {
        cardInstanceId: source.instanceId, controllerId: bot.id, zone, faceUp: true, locationVersion: source.locationVersion,
      };
      assert.equal((await game.moveCard(source, other, "graveyard", { fromZone: zone })).success, true);
      assert.equal(source.owner, other.id);
      const context: ActivationRuntimeContext = {
        committed: true, costsPaid: true, sourceMoved: true, sourceAtActivation,
        latestSourceLocation: { cardInstanceId: source.instanceId, controllerId: other.id, zone: "graveyard", faceUp: true, locationVersion: source.locationVersion },
      };
      const before = other.lp;
      const result = kind === "monster"
        ? await game.effectEngine.activateMonsterEffect(source, bot, null, zone, context)
        : await game.effectEngine.activateSpellTrapEffect(source, bot, null, zone, context);
      assert.equal(result.success, true, result.reason || undefined);
      assert.equal(other.lp, before - 300, "the original activation controller chooses the effect's opponent");
      assert.ok(other.graveyard.includes(source));
    });

    for (const invalid of ["before cost", "foreign controller", "missing snapshot", "different instance", "missing identity", "uncommitted", "unpaid", "not moved", "wrong zone", "stale version", "different latest instance", "stale latest version"] as const) {
      test(`${kind} ownership cannot be bypassed with ${invalid} (${actor})`, async t => {
        const { game, bot, other } = scenario(t, actor);
        const source = runtimeCard({ cardKind: kind, subtype: kind === "spell" ? "continuous" : null,
          effects: [{ id: "moved_source_effect", timing: "ignition", activationZones: [kind === "spell" ? "spellTrap" : "field"], actions: [{ type: "damage", player: "opponent", amount: 300 }] }] }, other.id);
        const zone = kind === "spell" ? "spellTrap" : "field";
        source.locationVersion = 2;
        other.graveyard.push(source);
        const context: ActivationRuntimeContext = {
          committed: true, costsPaid: true, sourceMoved: true,
          sourceAtActivation: { cardInstanceId: source.instanceId, controllerId: bot.id, zone, faceUp: true, locationVersion: 1 },
          latestSourceLocation: { cardInstanceId: source.instanceId, controllerId: other.id, zone: "graveyard", faceUp: true, locationVersion: 2 },
        };
        switch (invalid) {
          case "before cost": context.committed = false; context.costsPaid = false; context.sourceMoved = false; break;
          case "foreign controller": required(context.sourceAtActivation).controllerId = other.id; break;
          case "missing snapshot": context.sourceAtActivation = null; break;
          case "different instance": required(context.sourceAtActivation).cardInstanceId = source.instanceId + 1; break;
          case "missing identity": required(context.sourceAtActivation).cardInstanceId = null; break;
          case "uncommitted": context.committed = false; break;
          case "unpaid": context.costsPaid = false; break;
          case "not moved": context.sourceMoved = false; break;
          case "wrong zone": required(context.sourceAtActivation).zone = "hand"; break;
          case "stale version": required(context.sourceAtActivation).locationVersion = 2; break;
          case "different latest instance": required(context.latestSourceLocation).cardInstanceId = source.instanceId + 1; break;
          case "stale latest version": required(context.latestSourceLocation).locationVersion = 1; break;
        }
        const before = other.lp;
        const result = kind === "monster"
          ? await game.effectEngine.activateMonsterEffect(source, bot, null, zone, context)
          : await game.effectEngine.activateSpellTrapEffect(source, bot, null, zone, context);
        assert.equal(result.success, false);
        assert.equal(result.reason, "Card does not belong to the requesting player.");
        assert.equal(other.lp, before);
      });
    }
  }
}
