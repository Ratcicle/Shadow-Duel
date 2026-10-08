import assert from "node:assert/strict";
import test from "node:test";
import { quoteLpCost, createLpQuoteLedger, consumeLpQuoteReducers } from "../../src/core/ai/common/simulatedActions/shared.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import type { LpQuoteState } from "../../src/core/ai/common/simulatedActions/shared.js";

// Oracle property: a public read-only quote equals the engine preview for each
// owner and remaining-use boundary, while preserving all physical references.
for (const actor of ["bot", "player"] as const) {
  for (const used of [0, 1, 2]) {
    test(`pure LP quote matches runtime without consuming a reducer (${actor}/${used})`, t => {
      const game = createRuntimeGame({ disableChains: false });
      t.after(() => game.dispose("architecture_lp_quote"));
      game.turnCounter = 4;
      const owner = game[actor];
      const knight = required(game.createCardForOwner(173, owner));
      const source = required(game.createCardForOwner(170, owner));
      owner.lp = 5000;
      placeFieldCards(owner.field, knight);
      owner.hand.push(source);
      const reducer = required(knight.effects.find(effect => effect.id === "luminarch_pure_knight_lp_discount"));
      for (let count = 0; count < used; count++) game.effectEngine.markOncePerTurn(reducer, { player: owner, source: knight });
      const cost = required(source.effects.flatMap(effect => effect.activationCosts || []).find(action => action.type === "pay_lp"));
      assert.equal(cost.amount, 2000, "oracle quotes the card's actual declarative activation cost");
      const runtime = game.effectEngine.resolveLpCost(cost, { player: owner, source }, 2000, { preview: true });
      const before = structuredClone(game.oncePerTurnUsage.card.get(knight));
      for (let repeat = 0; repeat < 3; repeat++) {
        const quote = quoteLpCost({ action: cost, sourceCard: source, owner, state: game });
        assert.equal(quote.baseAmount, 2000);
        assert.equal(quote.finalAmount, used < 2 ? 1000 : 2000);
        assert.equal(quote.finalAmount, runtime.finalAmount);
        assert.equal(quote.appliedReducers.length, used < 2 ? 1 : 0);
        if (used < 2) {
          const applied = required(quote.appliedReducers[0]);
          assert.equal(applied.card, knight);
          assert.equal(applied.board, owner);
          assert.equal(applied.effect, reducer);
        }
        assert.deepEqual(game.oncePerTurnUsage.card.get(knight), before);
        assert.equal(owner.lp, 5000);
      }
      const { state } = createGameTreeCopy(game, owner);
      const simulatedQuote = quoteLpCost({ action: cost, sourceCard: required(state.bot.hand[0]), owner: state.bot, state });
      assert.equal(simulatedQuote.finalAmount, runtime.finalAmount);
      assert.deepEqual(state._simOncePerTurn || {}, {});
    });
  }

  for (const alreadyUsed of [0, 1, 2]) test(`sequential quotes use an explicit local ledger and preserve live usage (${actor}/${alreadyUsed})`, t => {
    const game = createRuntimeGame({ disableChains: false });
    t.after(() => game.dispose("architecture_lp_quote"));
    game.turnCounter = 4;
    const owner = game[actor];
    const knight = required(game.createCardForOwner(173, owner));
    const source = required(game.createCardForOwner(163, owner));
    placeFieldCards(owner.field, knight);
    const effect = required(knight.effects.find(entry => entry.id === "luminarch_pure_knight_lp_discount"));
    for (let count = 0; count < alreadyUsed; count++) game.effectEngine.markOncePerTurn(effect, { player: owner, source: knight });
    const ledger = createLpQuoteLedger(game);
    const before = structuredClone(game.oncePerTurnUsage.card.get(knight));
    for (let index = 0; index < 3; index++) {
      const expected = alreadyUsed + index < 2 ? 1000 : 2000;
      const quote = quoteLpCost({ action: { type: "pay_lp", amount: 2000 }, sourceCard: source, owner, state: game, ledger });
      assert.equal(quote.finalAmount, expected);
      assert.equal(quoteLpCost({ action: { type: "pay_lp", amount: 2000 }, sourceCard: source, owner, state: game, ledger }).finalAmount, expected);
      consumeLpQuoteReducers(ledger, quote);
    }
    assert.deepEqual(game.oncePerTurnUsage.card.get(knight), before);
    assert.equal(quoteLpCost({ action: { type: "pay_lp", amount: 2000 }, sourceCard: source, owner, state: game }).finalAmount, alreadyUsed < 2 ? 1000 : 2000);
  });

  test(`minimal frozen public views need no Game capability or zone graph (${actor})`, t => {
    const game = createRuntimeGame({ disableChains: false });
    t.after(() => game.dispose("architecture_lp_quote"));
    game.turnCounter = 4;
    const knight = required(game.createCardForOwner(173, game[actor]));
    const source = required(game.createCardForOwner(163, game[actor]));
    const owner = Object.freeze({ id: actor, lp: 5000, field: Object.freeze([knight]) });
    const opponent = Object.freeze({ id: actor === "bot" ? "player" : "bot", lp: 8000, field: Object.freeze([]) });
    const state: LpQuoteState<typeof knight, typeof owner | typeof opponent> = {
      turnCounter: 4, bot: actor === "bot" ? owner : opponent, player: actor === "player" ? owner : opponent,
      oncePerTurnUsage: game.oncePerTurnUsage, oncePerTurnTurnCounter: game.oncePerTurnTurnCounter,
    };
    Object.defineProperty(state, "_gameRef", { get() { throw new Error("live Game access is forbidden for a pure quote"); } });
    Object.freeze(state);
    const ledger = createLpQuoteLedger(state);
    const quote = quoteLpCost({ action: { type: "pay_lp", amount: 2000 }, sourceCard: source, owner, state, ledger });
    assert.equal(quote.finalAmount, 1000);
    assert.equal(required(quote.appliedReducers[0]).card, knight);
    assert.equal(required(quote.appliedReducers[0]).board, owner);
    consumeLpQuoteReducers(ledger, quote);
    assert.equal(owner.lp, 5000);
    assert.equal(game.oncePerTurnUsage.card.get(knight), undefined);
  });

  for (const sourceId of [163, 165, 151, 251]) {
    test(`LP reducer filters source kind and archetype (${actor}/${sourceId})`, t => {
      const game = createRuntimeGame({ disableChains: false });
      t.after(() => game.dispose("architecture_lp_quote"));
      game.turnCounter = 4;
      const owner = game[actor];
      const knight = required(game.createCardForOwner(173, owner));
      const source = required(game.createCardForOwner(sourceId, owner));
      placeFieldCards(owner.field, knight);
      const action = { type: "pay_lp", amount: 2000 } as const;
      const runtime = game.effectEngine.resolveLpCost(action, { player: owner, source }, 2000, { preview: true });
      const quote = quoteLpCost({ action, sourceCard: source, owner, state: game });
      const qualifies = source.archetype === "Luminarch" && (source.cardKind === "spell" || source.cardKind === "trap");
      assert.equal(quote.finalAmount, qualifies ? 1000 : 2000);
      assert.equal(quote.finalAmount, runtime.finalAmount);
    });
  }

  for (const kind of ["spell", "trap", "monster"] as const) for (const archetype of ["Luminarch", "Dragon"]) {
    test(`the declared LP source filter admits Spell/Trap only within its archetype (${actor}/${kind}/${archetype})`, t => {
      const game = createRuntimeGame({ disableChains: false });
      t.after(() => game.dispose("architecture_lp_quote"));
      game.turnCounter = 4;
      const owner = game[actor];
      const knight = required(game.createCardForOwner(173, owner));
      // Controlled public Card fixture varies only the two declarative filters.
      const source = required(game.createCardForOwner(163, owner));
      source.cardKind = kind;
      source.archetype = archetype;
      source.archetypes = [archetype];
      placeFieldCards(owner.field, knight);
      const action = { type: "pay_lp", amount: 2000 } as const;
      const runtime = game.effectEngine.resolveLpCost(action, { player: owner, source }, 2000, { preview: true });
      const quote = quoteLpCost({ action, sourceCard: source, owner, state: game });
      assert.equal(quote.finalAmount, archetype === "Luminarch" && kind !== "monster" ? 1000 : 2000);
      assert.equal(quote.finalAmount, runtime.finalAmount);
    });
  }

  test(`activation-cost quotes use current LP for fractions and obey turn expiry (${actor})`, t => {
    const game = createRuntimeGame({ disableChains: false });
    t.after(() => game.dispose("architecture_lp_quote"));
    game.turnCounter = 4;
    const owner = game[actor];
    owner.lp = 5000;
    const knight = required(game.createCardForOwner(173, owner));
    const source = required(game.createCardForOwner(163, owner));
    placeFieldCards(owner.field, knight);
    const effect = required(knight.effects.find(entry => entry.id === "luminarch_pure_knight_lp_discount"));
    for (let count = 0; count < 2; count++) game.effectEngine.markOncePerTurn(effect, { player: owner, source: knight });
    const action = { type: "pay_lp", fraction: 0.5 } as const;
    assert.equal(quoteLpCost({ action, sourceCard: source, owner, state: game }).finalAmount, 2500);
    game.turnCounter = 5;
    const before = structuredClone(game.oncePerTurnUsage.card.get(knight));
    const quote = quoteLpCost({ action, sourceCard: source, owner, state: game });
    assert.equal(quote.baseAmount, 2500);
    assert.equal(quote.finalAmount, 1500);
    assert.deepEqual(game.oncePerTurnUsage.card.get(knight), before, "preview must not reset stale runtime usage");
  });
}
