import assert from "node:assert/strict";
import test from "node:test";

import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import { handleNegateSummonOrActivationAndDestroy } from "../../src/core/actionHandlers/negation.js";
import { FAST_EFFECT_ORIGINS } from "../../src/core/chain/timing.js";
import {
  SUMMON_MODES,
  SUMMON_ORIGINS,
  SUMMON_STATUSES,
} from "../../src/core/game/summon/transaction.js";

// Official baseline: a Set is not a Summon; inherent Summons may be negated,
// while a Summon performed during an effect's resolution has no separate
// negation window. Rulebook and PSCT Part 5:
// https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf
// https://www.yugioh-card.com/en/play/psct/psct-5/

function createMonster(owner, overrides = {}) {
  return new Card(
    {
      id: overrides.id ?? 9000,
      name: overrides.name || "Test Monster",
      cardKind: "monster",
      level: overrides.level ?? 4,
      atk: overrides.atk ?? 1000,
      def: overrides.def ?? 1000,
      effects: overrides.effects || [],
      monsterType: overrides.monsterType || null,
      extraDeckSummonProcedure: overrides.extraDeckSummonProcedure || null,
    },
    owner.id,
  );
}

function createSummonGame(t) {
  const game = new Game({
    laboratoryMode: true,
    laboratoryUseBot: false,
    chainResponseTimeoutMs: 0,
  });
  game.turn = "player";
  game.turnCounter = 3;
  game.phase = "main1";
  game.phaseDelayMs = 0;
  game.aiSuccessfulActionDelayMs = 0;
  game.aiPresentationStepDelayMs = 0;
  game.player.hand = [];
  game.player.field = [];
  game.player.spellTrap = [];
  game.player.graveyard = [];
  game.player.banished = [];
  game.player.extraDeck = [];
  game.player.summonCount = 0;
  game.player.normalSummonsThisTurn = [];
  game.bot.hand = [];
  game.bot.field = [];
  game.bot.spellTrap = [];
  game.bot.graveyard = [];
  game.bot.banished = [];
  game.bot.extraDeck = [];
  game.waitForPresentationDelay = async () => {};
  game.waitForBoardPresentation = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.updateBoard = () => {};
  t.after(() => game.dispose("summon_test_complete"));
  return game;
}

test("[CS-03] Normal Set não abre summon_attempt nem after_summon", async (t) => {
  const game = createSummonGame(t);
  const card = createMonster(game.player, { name: "Set Monster" });
  game.player.hand.push(card);

  const timingOrigins = [];
  const afterSummons = [];
  const monsterSets = [];
  const originalTiming = game.chainSystem.runFastEffectTiming.bind(
    game.chainSystem,
  );
  game.chainSystem.runFastEffectTiming = async (input) => {
    timingOrigins.push(input.origin);
    return await originalTiming(input);
  };
  game.on("after_summon", (payload) => afterSummons.push(payload));
  game.on("monster_set", (payload) => monsterSets.push(payload));

  const result = await game.performNormalSummon(
    game.player,
    0,
    "defense",
    true,
  );

  assert.equal(result.success, true);
  assert.equal(result.set, true);
  assert.equal(game.player.summonCount, 1);
  assert.deepEqual(game.player.field, [card]);
  assert.equal(card.isFacedown, true);
  assert.equal(card.setTurn, game.turnCounter);
  assert.equal(afterSummons.length, 0);
  assert.equal(monsterSets.length, 1);
  assert.equal(
    timingOrigins.includes(FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT),
    false,
  );
  assert.equal(game.chainSystem.getChainLength(), 0);
});

test("[CS-03] Flip Summon abre janela de negação", async (t) => {
  const game = createSummonGame(t);
  const card = createMonster(game.player, { name: "Flip Monster" });
  card.isFacedown = true;
  card.position = "defense";
  card.setTurn = 1;
  card.positionChangedThisTurn = false;
  game.player.field.push(card);

  let attemptWindows = 0;
  const afterSummons = [];
  const moved = [];
  const originalTiming = game.chainSystem.runFastEffectTiming.bind(
    game.chainSystem,
  );
  const originalOpenWindow = game.chainSystem.openChainWindow.bind(
    game.chainSystem,
  );
  game.chainSystem.openChainWindow = async (context, options) => {
    if (context.type === "summon_attempt") {
      assert.equal(options.firstPlayer, game.player);
    }
    return await originalOpenWindow(context, options);
  };
  game.chainSystem.runFastEffectTiming = async (input) => {
    if (input.origin === FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT) {
      attemptWindows += 1;
      assert.equal(game.player.field.includes(card), false);
      assert.equal(card.locationVersion, 0);
      assert.equal(input.context.summonId, 1);
    }
    return await originalTiming(input);
  };
  game.on("after_summon", (payload) => afterSummons.push(payload));
  game.on("card_moved", (payload) => moved.push(payload));

  const result = await game.flipSummon(card);

  assert.equal(result.success, true);
  assert.equal(attemptWindows, 1);
  assert.equal(afterSummons.length, 1);
  assert.equal(afterSummons[0].method, "flip");
  assert.equal(game.player.field.includes(card), true);
  assert.equal(card.isFacedown, false);
  assert.equal(card.locationVersion, 1);
  assert.equal(moved.filter((payload) => payload.card === card).length, 1);
  assert.equal(game.getSummonState().last.status, "succeeded");
});

test(
  "[CS-03] Tribute Summon negada mantém Tributos pagos e consome a tentativa",
  async (t) => {
    const game = createSummonGame(t);
    const tribute = createMonster(game.player, {
      id: 9001,
      name: "Tribute Material",
    });
    const summoned = createMonster(game.player, {
      id: 9002,
      name: "Tribute Monster",
      level: 5,
    });
    game.player.field.push(tribute);
    game.player.hand.push(summoned);

    const afterSummons = [];
    const moved = [];
    game.on("after_summon", (payload) => afterSummons.push(payload));
    game.on("card_moved", (payload) => moved.push(payload));
    let attempts = 0;
    game.offerSummonAttempt = async (card, player, options) => {
      attempts += 1;
      assert.equal(card, summoned);
      assert.equal(player, game.player);
      assert.deepEqual(game.player.graveyard, [tribute]);
      assert.equal(game.player.field.includes(summoned), false);
      assert.equal(game.player.hand.includes(summoned), false);
      const transaction = options.summonTransaction;
      game.markSummonNegated(transaction.summonId, {
        destination: "graveyard",
        destroyed: true,
        sourceCard: { id: 9999, name: "Summon Negator" },
      });
      return { ok: false, summonNegated: true, transaction };
    };

    const result = await game.performNormalSummon(
      game.player,
      0,
      "attack",
      false,
      [0],
    );

    assert.equal(result.success, false);
    assert.equal(result.summonNegated, true);
    assert.equal(attempts, 1);
    assert.equal(game.player.summonCount, 1);
    assert.equal(game.player.field.length, 0);
    assert.deepEqual(game.player.graveyard, [tribute, summoned]);
    assert.equal(afterSummons.length, 0);
    assert.equal(tribute.locationVersion, 1);
    assert.equal(summoned.locationVersion, 1);
    assert.equal(
      moved.filter((payload) => payload.card === summoned).length,
      1,
    );
    assert.equal(game.getSummonState().last.status, "negated");
    assert.equal(game.activeSummonTransaction, null);
  },
);

test(
  "[CS-03] Invocação produzida durante resolução não abre janela aninhada",
  async (t) => {
    const game = createSummonGame(t);
    const card = createMonster(game.player, { name: "Effect Summon" });
    game.player.hand.push(card);

    const afterSummons = [];
    const timingOrigins = [];
    const originalTiming = game.chainSystem.runFastEffectTiming.bind(
      game.chainSystem,
    );
    game.chainSystem.runFastEffectTiming = async (input) => {
      timingOrigins.push(input.origin);
      return await originalTiming(input);
    };
    game.on("after_summon", (payload) => afterSummons.push(payload));
    game.chainSystem.chainResolving = true;
    game.isResolvingEffect = true;

    const result = await game.moveCard(card, game.player, "field", {
      fromZone: "hand",
      position: "attack",
      isFacedown: false,
      resetAttackFlags: true,
      summonOrigin: SUMMON_ORIGINS.EFFECT_RESOLUTION,
      summonMethodOverride: "special",
      summonProcedure: "card_effect",
    });
    game.chainSystem.chainResolving = false;
    game.isResolvingEffect = false;

    assert.equal(result.success, true);
    assert.deepEqual(game.player.field, [card]);
    assert.equal(afterSummons.length, 1);
    assert.equal(afterSummons[0].summonOrigin, "effect_resolution");
    assert.equal(
      timingOrigins.includes(FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT),
      false,
    );
    assert.equal(game.getSummonState().last.summonOrigin, "effect_resolution");
    assert.equal(game.getSummonState().last.status, "succeeded");
  },
);

test("cancelamento pré-commit não consome ID nem recursos", async (t) => {
  const game = createSummonGame(t);
  const card = createMonster(game.player, { name: "Cancelled Summon" });
  game.player.hand.push(card);
  const prepared = game.createPreparedSummon({
    card,
    controller: game.player,
    sourceZone: "hand",
    summonOrigin: SUMMON_ORIGINS.PROCEDURE,
    summonMode: SUMMON_MODES.SUMMON,
    summonMethod: "normal",
    cancelled: true,
  });

  const result = await game.executeSummonTransaction(prepared);

  assert.equal(result.cancelled, true);
  assert.equal(result.summonId, null);
  assert.equal(game.nextSummonId, 1);
  assert.deepEqual(game.player.hand, [card]);
  assert.equal(game.getSummonState().active, false);
});

test("sucesso move a carta e publica after_summon exatamente uma vez", async (t) => {
  const game = createSummonGame(t);
  const card = createMonster(game.player, { name: "Normal Monster" });
  game.player.hand.push(card);
  const moved = [];
  const afterSummons = [];
  const transactionEvents = [];
  game.on("card_moved", (payload) => moved.push(payload));
  game.on("after_summon", (payload) => afterSummons.push(payload));
  game.on("summon_transaction", (payload) => transactionEvents.push(payload));

  const originalTiming = game.chainSystem.runFastEffectTiming.bind(
    game.chainSystem,
  );
  game.chainSystem.runFastEffectTiming = async (input) => {
    if (input.origin === FAST_EFFECT_ORIGINS.SUMMON_ATTEMPT) {
      assert.equal(game.player.hand.includes(card), false);
      assert.equal(game.player.field.includes(card), false);
      const publicSummon = game.getPublicState("player").summon;
      assert.equal(publicSummon.active, true);
      assert.equal(publicSummon.transaction.card.name, card.name);
      assert.equal(publicSummon.transaction.status, "awaiting_negation");
    }
    return await originalTiming(input);
  };

  const result = await game.performNormalSummon(
    game.player,
    0,
    "attack",
    false,
  );

  assert.equal(result.success, true);
  assert.equal(card.locationVersion, 1);
  assert.equal(moved.filter((payload) => payload.card === card).length, 1);
  assert.equal(afterSummons.length, 1);
  assert.equal(afterSummons[0].summonId, result.summonId);
  assert.equal(game.getSummonState().last.status, "succeeded");
  assert.doesNotThrow(() => JSON.stringify(transactionEvents));
});

test("múltiplos Tributos são pagos sem janela intermediária", async (t) => {
  const game = createSummonGame(t);
  const firstTribute = createMonster(game.player, {
    id: 9301,
    name: "First Tribute",
  });
  const secondTribute = createMonster(game.player, {
    id: 9302,
    name: "Second Tribute",
  });
  const summoned = createMonster(game.player, {
    id: 9303,
    name: "Two-Tribute Monster",
    level: 7,
  });
  game.player.field.push(firstTribute, secondTribute);
  game.player.hand.push(summoned);
  let attempts = 0;
  game.offerSummonAttempt = async (card, player, options) => {
    attempts += 1;
    assert.equal(card, summoned);
    assert.deepEqual(game.player.graveyard, [firstTribute, secondTribute]);
    assert.equal(game.player.field.length, 0);
    assert.ok(game.chainSystem.pendingTriggerOccurrences.length >= 2);
    return {
      ok: true,
      transaction: options.summonTransaction,
      ownsTransaction: false,
    };
  };

  const result = await game.performNormalSummon(
    game.player,
    0,
    "attack",
    false,
    [0, 1],
  );

  assert.equal(result.success, true);
  assert.equal(attempts, 1);
  assert.deepEqual(game.player.field, [summoned]);
  assert.equal(result.transaction.costs.length, 2);
  assert.ok(result.transaction.costs.every((cost) => cost.paid));
});

test("handler de negação marca a transação exata sem mover a carta", async (t) => {
  const game = createSummonGame(t);
  const summoned = createMonster(game.player, { name: "Pending Monster" });
  const negator = createMonster(game.player, { name: "Summon Negator" });
  const begun = game.beginSummonTransaction(
    game.createPreparedSummon({
      card: summoned,
      controller: game.player,
      sourceZone: "hand",
      summonOrigin: SUMMON_ORIGINS.PROCEDURE,
      summonMethod: "special",
    }),
  );
  assert.equal(begun.ok, true);
  const transaction = begun.transaction;
  let moveCalls = 0;
  const originalMoveCard = game.moveCard.bind(game);
  game.moveCard = async (...args) => {
    moveCalls += 1;
    return await originalMoveCard(...args);
  };
  const context = {
    type: "summon_attempt",
    summonId: transaction.summonId,
    summonTransaction: transaction,
  };

  const handled = await handleNegateSummonOrActivationAndDestroy(
    { type: "negate_summon_or_activation_and_destroy" },
    {
      source: negator,
      player: game.player,
      activationContext: { context },
    },
    {},
    { game },
  );

  assert.equal(handled, true);
  assert.equal(moveCalls, 0);
  assert.equal(transaction.status, SUMMON_STATUSES.NEGATED);
  assert.equal(transaction.negationOutcome.destroyed, true);
  assert.equal(transaction.negationOutcome.sourceCard, negator);
  assert.equal(context.summonNegated, true);
  game.finishSummonTransaction(transaction, {
    success: false,
    summonNegated: true,
    reason: "summon_negated",
  });
});

test("erro pós-commit não reembolsa custos e limpa a tentativa", async (t) => {
  const game = createSummonGame(t);
  const material = createMonster(game.player, {
    id: 9401,
    name: "Committed Material",
  });
  const summoned = createMonster(game.player, {
    id: 9402,
    name: "Failed Summon",
  });
  game.player.field.push(material);
  game.player.hand.push(summoned);
  const prepared = game.createPreparedSummon({
    card: summoned,
    controller: game.player,
    sourceZone: "hand",
    summonOrigin: SUMMON_ORIGINS.PROCEDURE,
    summonMethod: "special",
    costPayments: [
      {
        card: material,
        owner: game.player,
        fromZone: "field",
        toZone: "graveyard",
        kind: "material",
      },
    ],
    perform: async () => {
      throw new Error("forced_summon_failure");
    },
  });

  const result = await game.executeSummonTransaction(prepared);

  assert.equal(result.success, false);
  assert.equal(result.reason, "forced_summon_failure");
  assert.deepEqual(game.player.graveyard, [material, summoned]);
  assert.equal(game.player.hand.includes(summoned), false);
  assert.equal(material.locationVersion, 1);
  assert.equal(summoned.locationVersion, 1);
  assert.equal(game.getSummonState().last.status, "failed");
  assert.equal(game.activeSummonTransaction, null);
  assert.equal(game.summonProcedureDepth, 0);
});

test("reset limpa a tentativa sem reutilizar summonId", async (t) => {
  const game = createSummonGame(t);
  const firstCard = createMonster(game.player, { name: "Before Reset" });
  const begun = game.beginSummonTransaction(
    game.createPreparedSummon({
      card: firstCard,
      controller: game.player,
      sourceZone: "hand",
      summonOrigin: SUMMON_ORIGINS.PROCEDURE,
      summonMethod: "special",
    }),
  );
  assert.equal(begun.transaction.summonId, 1);

  game.resetDuelState("summon_test_reset", {
    turn: "player",
    phase: "main1",
    turnCounter: 3,
  });

  assert.equal(game.getSummonState().active, false);
  assert.equal(game.getSummonState().last, null);
  const secondCard = createMonster(game.player, { name: "After Reset" });
  const second = game.beginSummonTransaction(
    game.createPreparedSummon({
      card: secondCard,
      controller: game.player,
      sourceZone: "hand",
      summonOrigin: SUMMON_ORIGINS.PROCEDURE,
      summonMethod: "special",
    }),
  );
  assert.equal(second.transaction.summonId, 2);
  game.finishSummonTransaction(second.transaction, { success: true });
});

test("moveCard rejeita Invocação sem summonOrigin explícito", (t) => {
  const game = createSummonGame(t);
  const card = createMonster(game.player, { name: "Explicit origin" });
  game.player.hand.push(card);
  const nextSummonId = game.nextSummonId;
  const result = game.moveCard(card, game.player, "field", { fromZone: "hand" });

  assert.equal(result.success, false);
  assert.equal(result.code, "SUMMON_ORIGIN_REQUIRED");
  assert.ok(game.player.hand.includes(card));
  assert.equal(game.nextSummonId, nextSummonId);
  assert.equal(game.resolveSummonOrigin, undefined);
});

test("NullChainSystem mantém a Invocação por efeito sem janela", async (t) => {
  const game = new Game({
    disableChains: true,
    laboratoryMode: true,
    laboratoryUseBot: false,
  });
  t.after(() => game.dispose("null_chain_summon_test_complete"));
  game.turn = "player";
  game.turnCounter = 2;
  game.phase = "main1";
  game.updateBoard = () => {};
  game.waitForBoardPresentation = async () => {};
  game.player.hand = [];
  game.player.field = [];
  const card = createMonster(game.player, { name: "No-Chain Summon" });
  game.player.hand.push(card);

  const result = await game.moveCard(card, game.player, "field", {
    fromZone: "hand",
    summonOrigin: SUMMON_ORIGINS.EFFECT_RESOLUTION,
    summonMethodOverride: "special",
    summonProcedure: "card_effect",
  });

  assert.equal(result.success, true);
  assert.deepEqual(game.player.field, [card]);
  assert.equal(game.chainSystem.getFastEffectState().state, "open");
  assert.equal(game.getSummonState().last.status, "succeeded");
});

test("IDs de Invocação são monotônicos e isolados por Game", async (t) => {
  const first = createSummonGame(t);
  const second = createSummonGame(t);
  first.chainSystem.chainResolving = true;
  second.chainSystem.chainResolving = true;

  const summonByEffect = async (game, id) => {
    const card = createMonster(game.player, { id, name: `Monster ${id}` });
    game.player.hand.push(card);
    return await game.moveCard(card, game.player, "field", {
      fromZone: "hand",
      summonOrigin: SUMMON_ORIGINS.EFFECT_RESOLUTION,
      summonMethodOverride: "special",
      summonProcedure: "card_effect",
    });
  };

  const firstResult = await summonByEffect(first, 9101);
  const secondResult = await summonByEffect(first, 9102);
  const isolatedResult = await summonByEffect(second, 9201);

  assert.deepEqual(
    [firstResult.summonId, secondResult.summonId, isolatedResult.summonId],
    [1, 2, 1],
  );
  assert.doesNotThrow(() => JSON.stringify(first.getPublicState("player")));
  assert.equal(first.getPublicState("player").summon.last.summonId, 2);
});
