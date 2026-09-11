import assert from "node:assert/strict";
import test from "node:test";
import type ChainSystem from "../../src/core/ChainSystem.js";
import type { ChainPlayer } from "../../src/core/contracts/chainRuntime.js";
import { record, required, unsafeFixture } from "../helpers/fixtures.js";
import type { HarnessTrace } from "./helpers/chainHarness.js";
import { installPreparedResponses } from "./helpers/chainHarness.js";

import {
  FAST_EFFECT_ORIGINS,
  FAST_EFFECT_STATES,
} from "../../src/core/chain/timing.js";
import { canStartAction } from "../../src/core/game/actions/guard.js";
import { resolveEventEntries } from "../../src/core/game/events/eventResolver.js";
import { setSpellOrTrap } from "../../src/core/game/spellTrap/set.js";
import {
  createChainHarness,
  createTestCard,
  createTestEffect,
  placeCard,
} from "./helpers/chainHarness.js";

// Official baseline: Fast Effect Timing.
// https://www.yugioh-card.com/en/play/fast-effect-timing/

function createPreparedQuickEffect(
  chain: ChainSystem,
  controller: ChainPlayer,
  name: string,
) {
  return chain.createPreparedActivation({
    card: createTestCard({ name }),
    controller,
    effect: createTestEffect({
      id: `${name.toLowerCase().replaceAll(" ", "_")}_effect`,
      speed: 2,
      isQuickEffect: true,
    }),
    activationZone: "field",
    committed: true,
    costsPaid: true,
  });
}

function createPreparedTriggerEffect(
  chain: ChainSystem,
  controller: ChainPlayer,
  name: string,
) {
  return chain.createPreparedActivation({
    card: createTestCard({ name }),
    controller,
    effect: createTestEffect({
      id: `${name.toLowerCase().replaceAll(" ", "_")}_effect`,
      timing: "on_event",
      speed: 1,
    }),
    activationZone: "field",
    selectionKind: "triggered",
    committed: true,
    costsPaid: true,
  });
}

function offeredPlayers(
  trace: HarnessTrace,
  timingWindowId: number | null = null,
) {
  return trace.events
    .filter(
      (entry) =>
        entry.channel === "notify" &&
        entry.eventName === "fast_effect_priority" &&
        required(required(entry.payload).decision) === "offered" &&
        (timingWindowId == null ||
          required(required(entry.payload).timingWindowId) === timingWindowId),
    )
    .map((entry) => required(required(entry.payload).playerId));
}

test("[CS-02] jogador do turno recebe a primeira oportunidade após ação sem corrente", async () => {
  const { chain, player, bot, trace } = createChainHarness();

  const result = await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN,
    actionPlayer: bot,
    context: { type: "action_without_chain", event: "card_set" },
  });

  assert.deepEqual(offeredPlayers(trace, 1), [player.id, bot.id]);
  assert.equal(result.chainBuilt, false);
  assert.equal(required(result.state).state, FAST_EFFECT_STATES.OPEN);
  assert.equal(
    required(result.state).origin,
    FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN,
  );
  assert.equal(required(result.state).priorityPlayerId, player.id);
});

test("[CS-02] prioridade após o último Trigger Link vai ao outro jogador", async () => {
  const { chain, player, bot, trace } = createChainHarness();
  const firstTrigger = createPreparedTriggerEffect(
    chain,
    player,
    "First trigger",
  );
  const lastTrigger = createPreparedTriggerEffect(chain, bot, "Last trigger");

  const result = await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.TRIGGER_CHAIN,
    actionPlayer: player,
    preparedActivations: [firstTrigger, lastTrigger],
    context: { type: "summon", event: "after_summon" },
  });

  assert.deepEqual(offeredPlayers(trace, 1), [player.id, bot.id]);
  assert.equal(result.chainBuilt, true);
});

test("[CS-02] jogador do turno recebe prioridade após corrente sem novos triggers", async () => {
  const { chain, player, bot, trace } = createChainHarness();
  const root = createPreparedQuickEffect(chain, player, "Activation root");

  await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.ACTIVATION,
    actionPlayer: player,
    preparedActivation: root,
    context: { type: "effect_activation", event: "effect_activation" },
  });

  assert.deepEqual(offeredPlayers(trace, 2), [player.id, bot.id]);
});

test("oponente recebe a primeira oportunidade após CL1", async () => {
  const { chain, player, bot, trace } = createChainHarness();
  const root = createPreparedQuickEffect(chain, player, "CL1 source");

  await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.ACTIVATION,
    actionPlayer: player,
    preparedActivation: root,
    context: { type: "effect_activation" },
  });

  assert.equal(offeredPlayers(trace, 1)[0], bot.id);
});

test("Summon, Set, draw, posição e ataque sem ativação nunca viram Chain Links", async () => {
  const { chain, player } = createChainHarness();
  const events = [
    "after_summon",
    "card_set",
    "normal_draw",
    "position_change",
    "attack_declared",
  ];

  for (const event of events) {
    const result = await chain.runFastEffectTiming({
      origin: FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN,
      actionPlayer: player,
      context: { type: "action_without_chain", event },
    });
    assert.equal(result.chainBuilt, false, event);
    assert.equal(chain.getChainLength(), 0, event);
    assert.equal(chain.activeChainId, null, event);
  }
});

test("Set real compromete a carta antes da janela e não fabrica CL1", async () => {
  const { chain, game, player } = createChainHarness();
  const card = createTestCard({
    name: "Set source",
    cardKind: "spell",
    subtype: "normal",
  });
  placeCard(player, "hand", card);
  game.guardActionStart = () => ({ ok: true });

  const result = await setSpellOrTrap.call(
    unsafeFixture<ThisParameterType<typeof setSpellOrTrap>>(
      game,
      "Isolated Set fixture installs the guard and uses the real Chain timing coordinator.",
    ),
    unsafeFixture<Parameters<typeof setSpellOrTrap>[0]>(
      card,
      "Minimal Chain card fixture exercises Set without other model capabilities.",
    ),
    0,
    unsafeFixture<Parameters<typeof setSpellOrTrap>[2]>(
      player,
      "The Set fixture uses only hand and spell/trap zones.",
    ),
  );

  assert.ok(result.ok === true);
  assert.equal(player.hand.includes(card), false);
  assert.equal(player.spellTrap.includes(card), true);
  assert.equal(card.isFacedown, true);
  assert.equal(chain.getChainLength(), 0);
  assert.ok("timing" in result);
  assert.equal(
    record(record(result.timing).state).state,
    FAST_EFFECT_STATES.OPEN,
  );
});

test("event resolver encaminha posição e ataque direto ao coordenador", async () => {
  const { game, player } = createChainHarness();
  const events: Array<{ eventName: string; payload: unknown }> = [];
  game.devLog = () => {};
  game.checkAndOfferTraps = async (eventName, payload) => {
    events.push({ eventName, payload: required(payload) });
    return { ok: true, chainBuilt: false };
  };

  await resolveEventEntries.call(
    unsafeFixture<ThisParameterType<typeof resolveEventEntries>>(
      game,
      "Event resolver fixture supplies only timing forwarding, with unrelated Game capabilities omitted.",
    ),
    "position_change",
    unsafeFixture<Parameters<typeof resolveEventEntries>[1]>(
      { player, card: createTestCard({ name: "Position source" }) },
      "Legacy event fixture uses minimal Chain cards and players for timing forwarding.",
    ),
    [],
  );
  await resolveEventEntries.call(
    unsafeFixture<ThisParameterType<typeof resolveEventEntries>>(
      game,
      "Event resolver fixture supplies only timing forwarding, with unrelated Game capabilities omitted.",
    ),
    "attack_declared",
    unsafeFixture<Parameters<typeof resolveEventEntries>[1]>(
      {
        player,
        attackerOwner: player,
        attacker: createTestCard({ name: "Direct attacker" }),
        defender: null,
        defenderOwner: null,
      },
      "Legacy event fixture uses minimal Chain cards and players for timing forwarding.",
    ),
    [],
  );

  assert.deepEqual(
    events.map((entry) => entry.eventName),
    ["position_change", "attack_declared"],
  );
  assert.equal(record(events[1].payload).defenderOwner, null);
});

test("correntes sucessivas repetem a verificação pós-corrente", async () => {
  const { chain, player } = createChainHarness();
  let firstUsed = false;
  let secondUsed = false;
  const first = createPreparedQuickEffect(chain, player, "First fast effect");
  const second = createPreparedQuickEffect(chain, player, "Second fast effect");

  installPreparedResponses(chain, async (responder, context) => {
    if (
      responder === player &&
      required(context).timingOrigin ===
        FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN &&
      !firstUsed
    ) {
      firstUsed = true;
      return first;
    }
    if (
      responder === player &&
      required(context).timingOrigin === FAST_EFFECT_ORIGINS.POST_CHAIN &&
      !secondUsed
    ) {
      secondUsed = true;
      return second;
    }
    return null;
  });

  const result = await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN,
    actionPlayer: player,
    context: { type: "action_without_chain", event: "position_change" },
  });

  assert.equal(result.chainBuilt, true);
  assert.equal(firstUsed, true);
  assert.equal(secondUsed, true);
  assert.equal(chain.nextChainId, 3);
  assert.equal(chain.nextTimingWindowId, 4);
});

test("ação interna durante resolução não abre janela aninhada", async () => {
  const { chain, player, trace } = createChainHarness();
  chain.isResolving = true;

  const result = await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN,
    actionPlayer: player,
    context: { type: "action_without_chain", event: "position_change" },
  });

  assert.equal(result.deferred, true);
  assert.equal(result.reason, "timing_window_busy");
  assert.equal(chain.nextTimingWindowId, 1);
  assert.deepEqual(offeredPlayers(trace), []);
});

test("reentrada não abre um segundo modal ou janela", async () => {
  const { chain, player } = createChainHarness();
  let releaseFirstOffer: () => void;
  let signalFirstOffer: () => void;
  const firstOfferStarted = new Promise<void>((resolve) => {
    signalFirstOffer = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseFirstOffer = resolve;
  });
  let offers = 0;

  chain.offerChainResponse = async () => {
    offers += 1;
    if (offers === 1) {
      signalFirstOffer!();
      await gate;
    }
    return null;
  };

  const activeSession = chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN,
    actionPlayer: player,
    context: { type: "action_without_chain", event: "card_set" },
  });
  await firstOfferStarted;
  const reentry = await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN,
    actionPlayer: player,
    context: { type: "action_without_chain", event: "normal_draw" },
  });
  releaseFirstOffer!();
  await activeSession;

  assert.equal(reentry.deferred, true);
  assert.equal(reentry.reason, "timing_window_busy");
  assert.equal(offers, 2);
});

test("erro limpa a sessão sem reutilizar o timingWindowId", async () => {
  const { chain, player, trace } = createChainHarness();
  const originalOfferChainResponses = chain.offerChainResponses.bind(chain);
  const root = createPreparedQuickEffect(chain, player, "Failing window");
  chain.offerChainResponses = async () => {
    throw { message: "forced timing failure" };
  };

  const failed = await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.ACTIVATION,
    actionPlayer: player,
    preparedActivation: root,
    context: { type: "effect_activation" },
  });
  chain.offerChainResponses = originalOfferChainResponses;
  const recovered = await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN,
    actionPlayer: player,
    context: { type: "action_without_chain", event: "card_set" },
  });

  assert.ok(failed.ok === false);
  assert.equal(failed.reason, "forced timing failure");
  assert.equal(required(failed.state).state, FAST_EFFECT_STATES.OPEN);
  assert.equal(chain.isChainWindowOpen(), false);
  assert.ok(recovered.ok === true);
  assert.deepEqual(offeredPlayers(trace, 2), ["player", "bot"]);
  assert.equal(chain.nextTimingWindowId, 3);
});

test("action guard rejeita ação lenta fora do estado open", () => {
  const game = {
    selectionState: "idle",
    eventResolutionDepth: 0,
    isResolvingEffect: false,
    turn: "player",
    phase: "main1",
    chainSystem: {
      isChainWindowOpen: () => false,
      isOpenGameState: () => false,
    },
    isDisposed: () => false,
    devLog() {},
  };

  const result = canStartAction.call(
    unsafeFixture<ThisParameterType<typeof canStartAction>>(
      game,
      "The fixture must reject a slow action at the timing guard before any other capability.",
    ),
    {
      actor: unsafeFixture<
        NonNullable<NonNullable<Parameters<typeof canStartAction>[0]>["actor"]>
      >(
        { id: "player" },
        "Only actor identity is read before the timing guard rejects this action.",
      ),
      kind: "set_spell_trap",
    },
  );

  assert.ok(result.ok === false);
  assert.equal(result.code, "BLOCKED_FAST_EFFECT_TIMING");
});

test("estado público e eventos de timing são serializáveis", async () => {
  const { chain, game, player, trace } = createChainHarness();
  await chain.runFastEffectTiming({
    origin: FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN,
    actionPlayer: player,
    context: { type: "action_without_chain", event: "card_set" },
  });

  const timingEvents = trace.events.filter(
    (entry) =>
      entry.eventName === "fast_effect_timing" ||
      entry.eventName === "fast_effect_priority",
  );
  const publicTiming = game.getPublicState!(player.id).chain.timing;

  assert.ok(timingEvents.length > 0);
  assert.doesNotThrow(() => JSON.stringify(timingEvents));
  assert.doesNotThrow(() => JSON.stringify(publicTiming));
  assert.deepEqual(publicTiming, chain.getFastEffectState());
});

test("IDs de timing são determinísticos e isolados entre harnesses", async () => {
  const first = createChainHarness();
  const second = createChainHarness();
  const run = (harness: ReturnType<typeof createChainHarness>) =>
    harness.chain.runFastEffectTiming({
      origin: FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN,
      actionPlayer: harness.player,
      context: { type: "action_without_chain", event: "card_set" },
    });

  await run(first);
  await run(first);
  await run(second);

  assert.deepEqual(
    first.trace.events
      .filter(
        (entry) =>
          entry.eventName === "fast_effect_priority" &&
          required(entry.payload).decision === "offered",
      )
      .map((entry) => required(entry.payload).timingWindowId),
    [1, 1, 2, 2],
  );
  assert.deepEqual(
    second.trace.events
      .filter(
        (entry) =>
          entry.eventName === "fast_effect_priority" &&
          required(entry.payload).decision === "offered",
      )
      .map((entry) => required(entry.payload).timingWindowId),
    [1, 1],
  );
});
