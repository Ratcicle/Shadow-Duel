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
