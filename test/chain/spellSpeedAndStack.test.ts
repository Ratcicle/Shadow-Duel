import assert from "node:assert/strict";
import test from "node:test";
import type { CardAction } from "../../src/core/contracts/actions.js";
import { objectResult, required, unsafeFixture } from "../helpers/fixtures.js";
import { createTestCandidate } from "./helpers/chainHarness.js";

import {
  createChainHarness,
  createTestCard,
  createTestEffect,
} from "./helpers/chainHarness.js";

// Official baseline: Rulebook v10, pp. 44-46.
// https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf

test("a ativação original ocupa CL1 e respostas resolvem em LIFO", async () => {
  const order: string[] = [];
  const { chain, player, bot } = createChainHarness({
    onActions(_actions, ctx) {
      order.push(required(ctx.source).name);
    },
  });
  const rootCard = createTestCard({ name: "Root" });
  const rootEffect = createTestEffect({
    id: "root",
    speed: 1,
    actions: [
      unsafeFixture<CardAction>(
        { type: "root" },
        "Synthetic action intercepted by the test harness; never dispatched to the action registry.",
      ),
    ],
  });
  const responseCard = createTestCard({ name: "Response" });
  const responseEffect = createTestEffect({
    id: "response",
    speed: 2,
    isQuickEffect: true,
    actions: [
      unsafeFixture<CardAction>(
        { type: "response" },
        "Synthetic action intercepted by the test harness; never dispatched to the action registry.",
      ),
    ],
  });
  let rootObservedAsCl1 = false;
  let responseAdded = false;

  chain.offerChainResponses = async () => {
    const rootLink = chain.getLastChainLink();
    if (!responseAdded && rootLink?.card === rootCard) {
      rootObservedAsCl1 =
        chain.chainStack.length === 1 && rootLink.chainLevel === 1;
      responseAdded = true;
      chain.addToChain(
        chain.createPreparedActivation({
          card: responseCard,
          controller: bot,
          effect: responseEffect,
          activationZone: "field",
          committed: true,
          costsPaid: true,
        }),
      );
    }
    return {
      offers: 0,
      activations: 0,
      lastActivator: null,
      chainBuilt: false,
      consecutivePasses: 2,
    };
  };

  await chain.openActivationChain(
    chain.createPreparedActivation({
      card: rootCard,
      controller: player,
      effect: rootEffect,
      activationZone: "field",
      committed: true,
      costsPaid: true,
    }),
  );

  assert.equal(rootObservedAsCl1, true);
  assert.deepEqual(order, ["Response", "Root"]);
});

for (const actor of ["player", "bot"] as const) {
  for (const rootSucceeds of [false, true]) {
    test(`activation reports its own link when another link has a different result (${actor}, root=${rootSucceeds})`, async () => {
      const rootCard = createTestCard({ name: "Initial activation" });
      const responseCard = createTestCard({ name: "Independent response" });
      const { chain, player, bot } = createChainHarness({
        onActions(_actions, ctx) {
          return { success: ctx.source === rootCard ? rootSucceeds : !rootSucceeds, needsSelection: false };
        },
      });
      const controller = actor === "player" ? player : bot;
      let responded = false;
      chain.offerChainResponses = async () => {
        if (!responded && chain.getLastChainLink()?.card === rootCard) {
          responded = true;
          chain.addToChain(chain.createPreparedActivation({
            card: responseCard, controller,
            effect: createTestEffect({ id: "independent_response", speed: 2 }),
            activationZone: "field", committed: true, costsPaid: true,
          }));
        }
        return { offers: 0, activations: 0, lastActivator: null, chainBuilt: false, consecutivePasses: 2 };
      };
      const result = await chain.openActivationChain(chain.createPreparedActivation({
        card: rootCard, controller, effect: createTestEffect({ id: "initial_activation", speed: 1 }),
        activationZone: "field", committed: true, costsPaid: true,
      }));
      assert.equal(result.success, rootSucceeds);
      assert.equal(result.ok, rootSucceeds);
      assert.equal(result.resolutionResult?.success, false, "aggregate Chain diagnostics still retain the other link failure");
      assert.equal(result.resolutionResult?.linkResults?.length, 2);
    });
  }
  test(`initial activation preserves its negation independently of a failed response (${actor})`, async () => {
    const { chain, player, bot } = createChainHarness({ onActions: () => ({ success: false }) });
    const controller = actor === "player" ? player : bot;
    const card = createTestCard({ name: "Negated activation" });
    chain.offerChainResponses = async () => {
      const root = chain.getLastChainLink();
      if (root?.card === card) {
        root.activationNegated = true;
        chain.addToChain(chain.createPreparedActivation({
          card: createTestCard({ name: "Failed response" }), controller,
          effect: createTestEffect({ id: "failed_response", speed: 2 }),
          activationZone: "field", committed: true, costsPaid: true,
        }));
      }
      return { offers: 0, activations: 0, lastActivator: null, chainBuilt: false, consecutivePasses: 2 };
    };
    const result = await chain.openActivationChain(chain.createPreparedActivation({
      card, controller, effect: createTestEffect({ id: "negated_activation", speed: 1 }),
      activationZone: "field", committed: true, costsPaid: true,
    }));
    assert.equal(result.activationNegated, true);
    assert.equal(result.resolutionResult?.success, false);
  });

  test(`initial activation cannot hide a Chain finalization failure (${actor})`, async () => {
    const { chain, player, bot } = createChainHarness();
    chain.finalizeWholeChain = async () => ({ success: false, reason: "test_cleanup_failed" });
    const result = await chain.openActivationChain(chain.createPreparedActivation({
      card: createTestCard({ name: "Successful activation" }), controller: actor === "player" ? player : bot,
      effect: createTestEffect({ id: "successful_activation", speed: 1 }),
      activationZone: "field", committed: true, costsPaid: true,
    }));
    assert.equal(result.success, false);
    assert.equal(result.ok, false);
    assert.equal(result.resolutionResult?.finalizationResult?.reason, "test_cleanup_failed");
  });
}

test("Spell Speed 2 não responde a Spell Speed 3", () => {
  const { chain, player } = createChainHarness();
  const counterEffect = createTestEffect({ id: "counter", speed: 3 });
  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: createTestCard({
          name: "Counter",
          cardKind: "trap",
          subtype: "counter",
          isFacedown: true,
        }),
        controller: player,
        effect: counterEffect,
        activationZone: "spellTrap",
        committed: true,
        costsPaid: true,
      }),
    ),
  );
  counterEffect.speed = 1;

  const result = chain.canActivateInChain(
    createTestEffect({ id: "quick", speed: 2 }),
    createTestCard({
      name: "Quick",
      cardKind: "spell",
      subtype: "quickplay",
    }),
    { type: "card_activation" },
  );

  assert.ok(result.ok === false);
  assert.equal(link.spellSpeed, 3);
  assert.match(
    required(result.reason),
    /Spell Speed 2 cannot respond to Spell Speed 3/,
  );
});

test("as oportunidades alternam e dois passes consecutivos encerram a construção", async () => {
  const { chain, player, bot } = createChainHarness();
  const offeredTo: string[] = [];
  chain.offerChainResponse = async (responder) => {
    offeredTo.push(required(responder).id);
    return null;
  };

  await chain.offerChainResponses(player, bot, { type: "card_activation" });

  assert.deepEqual(offeredTo, ["player", "bot"]);
  assert.equal(chain.getChainLength(), 0);
});

test("uma resposta reinicia a contagem de passes e mantém a alternância", async () => {
  const { chain, player, bot } = createChainHarness();
  const offeredTo: string[] = [];
  let responseUsed = false;
  const responseCard = createTestCard({ name: "Queued response" });
  const responseEffect = createTestEffect({
    id: "queued_response",
    speed: 2,
    isQuickEffect: true,
  });

  chain.offerChainResponse = async (responder) => {
    offeredTo.push(required(responder).id);
    if (!responseUsed) {
      responseUsed = true;
      return createTestCandidate(chain, required(responder), {
        card: responseCard,
        effect: responseEffect,
        sourceZone: "field",
      });
    }
    return null;
  };
  chain.prepareChainResponse = async (_response, responder) => ({
    success: true,
    preparedActivation: chain.createPreparedActivation({
      card: responseCard,
      controller: responder,
      effect: responseEffect,
      activationZone: "field",
      committed: true,
      costsPaid: true,
    }),
  });
  chain.publishChainLinkActivation = async () => ({
    ok: true,
    triggerPackages: [],
  });
  chain.appendActivationTriggerPackages = async () => ({ ok: true });

  await chain.offerChainResponses(player, bot, { type: "card_activation" });

  assert.deepEqual(offeredTo, ["player", "bot", "player"]);
  assert.equal(chain.getChainLength(), 1);
});

test("openChainWindow não abre nova janela durante resolução", async () => {
  const { chain } = createChainHarness();
  let offers = 0;
  chain.isResolving = true;
  chain.offerChainResponses = async () => {
    offers += 1;
    return {
      offers: 0,
      activations: 0,
      consecutivePasses: 2,
      lastActivator: null,
      chainBuilt: false,
    };
  };

  const result = objectResult(
    await chain.openChainWindow({ type: "card_activation" }),
  );

  assert.ok(result.ok === false);
  assert.equal(result.reason, "chain_window_busy");
  assert.equal(offers, 0);
  assert.equal(chain.isChainWindowOpen(), false);
});
