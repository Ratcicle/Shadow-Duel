import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { turnLineSearch, type BattleCandidateScoreInput } from "../../src/core/ai/TurnLineSearch.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { simulationState } from "../helpers/simulation.js";

for (const seat of ["player", "bot"] as const) {
  for (const destroyedParticipant of ["attacker", "target"] as const) {
    test(`battle scoring preserves ${destroyedParticipant} survival identity among same-name copies (${seat})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false,
        captureReplay: false, chainResponseTimeoutMs: 0 });
      t.after(() => game.dispose("architecture_battle_identity_test"));
      game.turn = seat; game.phase = "battle"; game.battleStep = "battle"; game.turnCounter = 4;
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
      game.player.controllerType = game.bot.controllerType = "ai";
      game.ui.showChainResponseModal = async () => null;
      const owner = game[seat], opponent = game[seat === "bot" ? "player" : "bot"];
      const make = (actor: typeof owner, atk: number) => {
        const card = new Card({ ...cardDefinition(1), effects: [], atk, def: atk }, actor.id);
        card.isFacedown = false; card.position = "attack"; placeFieldCards(actor.field, card);
        return card;
      };
      const attacker = make(owner, destroyedParticipant === "attacker" ? 500 : 1500);
      const target = make(opponent, destroyedParticipant === "target" ? 500 : 1500);
      const participant = destroyedParticipant === "attacker" ? attacker : target;
      const participantOwner = destroyedParticipant === "attacker" ? owner : opponent;
      const sister = make(participantOwner, 1000); sister.cannotAttackThisTurn = true;
      assert.equal(sister.name, participant.name); assert.equal(sister.id, participant.id);
      assert.notEqual(sister.instanceId, participant.instanceId);
      const copy = createPlanningCopy();
      const actor = (player: typeof owner) => ({ id: player.id, lp: player.lp,
        field: player.field.map(copy.cloneCardForSim) });
      const { temporaryBattlePairEffects: ignoredPairs, temporaryEventEffects: ignoredEvents, ...state } = simulationState({ _isPerspectiveState: true, turn: seat, phase: "main1", turnCounter: 4,
        bot: actor(owner), player: actor(opponent) });
      void ignoredPairs; void ignoredEvents;
      const observed: BattleCandidateScoreInput[] = [];
      await turnLineSearch(state, {
        generateMainPhaseActions: () => [], simulateMainPhaseAction: () => undefined,
        evaluateBoard: () => 0,
        scoreBattleAttackCandidate(context) {
          // Observe the candidate pool; no forced positive score and no
          // assertion that a suicidal candidate must become the chosen line.
          if (context.target?.instanceId === target.instanceId) observed.push(context);
          return 0;
        },
      }, { turnMode: "mainBattleMain2", maxDepth: 1, nodeBudget: 4, battleStepLimit: 1 });
      const context = required(observed[0], "the actual battle bridge must evaluate the physical candidate");
      const row = destroyedParticipant === "attacker" ? context.simState.bot : context.simState.player;
      assert.ok(!row.field.some(card => card.instanceId === participant.instanceId));
      assert.ok(row.graveyard.some(card => card.instanceId === participant.instanceId));
      assert.ok(row.field.some(card => card.instanceId === sister.instanceId));
      assert.ok(state.bot.field.some(card => card.instanceId === attacker.instanceId), "search leaves its input intact");
      assert.ok(state.player.field.some(card => card.instanceId === target.instanceId), "search leaves its input intact");
      assert.notStrictEqual(context.simState.bot.field, state.bot.field, "candidate has an isolated physical clone");

      await game.resolveCombat(attacker, target);
      assert.ok(participantOwner.graveyard.includes(participant));
      assert.ok(participantOwner.field.includes(sister));
      if (destroyedParticipant === "attacker") {
        assert.equal(context.attacker?.instanceId, attacker.instanceId,
          "scoring keeps the attacked original identity when it falls back to the pre-battle card");
        assert.equal(context.attackerSurvived, participantOwner.field.includes(participant));
      } else {
        assert.equal(context.target?.instanceId, target.instanceId);
        assert.equal(context.targetSurvived, participantOwner.field.includes(participant));
      }
    });
  }
}
