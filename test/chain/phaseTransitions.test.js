import test from "node:test";
import assert from "node:assert/strict";

import {
  FAST_EFFECT_ORIGINS,
  FAST_EFFECT_STATES,
} from "../../src/core/chain/timing.js";
import { nextPhase } from "../../src/core/game/turn/transitions.js";
import {
  createChainHarness,
  createTestCard,
  createTestEffect,
} from "./helpers/chainHarness.js";

// Official baseline: Fast Effect Timing and turn-player priority.
// https://www.yugioh-card.com/en/play/fast-effect-timing/

function createPhaseResponse(chain, controller) {
  return chain.createPreparedActivation({
    card: createTestCard({ name: "Phase response" }),
    controller,
    effect: createTestEffect({
      id: "phase_response",
      speed: 2,
      isQuickEffect: true,
    }),
    activationZone: "field",
    committed: true,
    costsPaid: true,
  });
}

test("[CS-11] corrente em phase_end reinicia a negociação antes da mudança de fase", async () => {
  const { chain, player, bot } = createChainHarness({ phase: "main1" });
  const response = createPhaseResponse(chain, bot);
  let responseUsed = false;

  chain.offerChainResponse = async (responder, context) => {
    if (
      responder === bot &&
      context.timingOrigin === FAST_EFFECT_ORIGINS.PHASE_TRANSITION_INTENT &&
      !responseUsed
    ) {
      responseUsed = true;
      return response;
    }
    return null;
  };
  chain.prepareChainResponse = async (candidate) => ({
    success: true,
    preparedActivation: candidate,
  });

  const interrupted = await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.PHASE_TRANSITION_INTENT,
    actionPlayer: player,
    phaseIntent: { fromPhase: "main1", toPhase: "battle" },
    context: {
      type: "phase_change",
      event: "phase_end",
      fromPhase: "main1",
      toPhase: "battle",
    },
  });
  const renewed = await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.PHASE_TRANSITION_INTENT,
    actionPlayer: player,
    phaseIntent: { fromPhase: "main1", toPhase: "battle" },
    context: {
      type: "phase_change",
      event: "phase_end",
      fromPhase: "main1",
      toPhase: "battle",
    },
  });

  assert.equal(interrupted.chainBuilt, true);
  assert.equal(interrupted.phaseTransitionInterrupted, true);
  assert.equal(interrupted.phaseTransitionAllowed, false);
  assert.equal(renewed.chainBuilt, false);
  assert.equal(renewed.phaseTransitionAllowed, true);
});

test("[CS-11] início de fase deixa o estado aberto para o jogador do turno", async () => {
  const { chain, player } = createChainHarness({ phase: "standby" });
  let offers = 0;
  chain.offerChainResponse = async () => {
    offers += 1;
    return null;
  };

  const result = await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.PHASE_START,
    actionPlayer: player,
    context: { type: "phase_change", event: "phase_start" },
  });

  assert.equal(offers, 0);
  assert.equal(result.state.state, FAST_EFFECT_STATES.OPEN);
  assert.equal(result.state.priorityPlayerId, player.id);
  assert.equal(result.state.timingWindowId, null);
});

test("passe do oponente autoriza phase_end sem segunda oferta", async () => {
  const { chain, player, bot } = createChainHarness({ phase: "main1" });
  const offered = [];
  chain.offerChainResponse = async (responder) => {
    offered.push(responder.id);
    return null;
  };

  const result = await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.PHASE_TRANSITION_INTENT,
    actionPlayer: player,
    phaseIntent: { fromPhase: "main1", toPhase: "battle" },
    context: { type: "phase_change", event: "phase_end" },
  });

  assert.deepEqual(offered, [bot.id]);
  assert.equal(result.phaseTransitionAllowed, true);
  assert.equal(result.phaseTransitionInterrupted, false);
  assert.equal(
    result.state.origin,
    FAST_EFFECT_ORIGINS.PHASE_TRANSITION_INTENT,
  );
});

test("nextPhase preserva a fase e o Battle Step quando a intenção foi interrompida", async () => {
  const { game, player } = createChainHarness({ phase: "battle" });
  game.gameOver = false;
  game.battleStep = "battle";
  game.damageStepTiming = null;
  game.isDisposed = () => false;
  game.guardActionStart = () => ({ ok: true });
  game.getNextPhase = () => "main2";
  game.checkAndOfferTraps = async () => ({
    ok: true,
    chainBuilt: true,
    needsSelection: false,
    phaseTransitionAllowed: false,
    phaseTransitionInterrupted: true,
  });
  game.clearAttackResolutionIndicators = () => {};
  game.clearAttackReadyIndicators = () => {};

  const result = await nextPhase.call(game);

  assert.equal(game.phase, "battle");
  assert.equal(game.battleStep, "battle");
  assert.equal(game.turn, player.id);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "phase_transition_interrupted");
});
