import test from "node:test";
import assert from "node:assert/strict";

import { CHAIN_ACTIVATION_KINDS } from "../../src/core/chain/link.js";
import {
  createChainHarness,
  createTestCard,
  createTestEffect,
  placeCard,
} from "./helpers/chainHarness.js";

// Official baseline: PSCT Part 3 and Rulebook v10, pp. 44-47.
// https://www.yugioh-card.com/en/play/psct/psct-3/

async function publishPreparedLink(chain, input) {
  const prepared = chain.createPreparedActivation({
    committed: true,
    costsPaid: true,
    ...input,
  });
  const link = chain.addToChain(prepared);
  await chain.publishChainLinkActivation(link);
  return link;
}

test("[CS-05] ativação de Spell/Trap Card difere da ativação de seu efeito face-up", async () => {
  const { chain, player, trace } = createChainHarness();
  const card = createTestCard({
    name: "Face-up Continuous Spell",
    cardKind: "spell",
    subtype: "continuous",
  });
  const effect = createTestEffect({ id: "faceup_effect", speed: 1 });
  placeCard(player, "spellTrap", card);

  const link = await publishPreparedLink(chain, {
    card,
    controller: player,
    effect,
    activationZone: "spellTrap",
    activationContext: {
      sourceZone: "spellTrap",
      activationZone: "spellTrap",
      sourceWasFacedown: false,
    },
  });

  assert.equal(
    link.activationKind,
    CHAIN_ACTIVATION_KINDS.SPELL_TRAP_EFFECT,
  );
  assert.deepEqual(
    trace.events.map((entry) => entry.eventName),
    ["effect_activated"],
  );
});

test("[CS-05] efeito de Spell/Trap no Cemitério não publica nova ativação da carta", async () => {
  const { chain, player, trace } = createChainHarness();
  const card = createTestCard({
    name: "Graveyard Spell",
    cardKind: "spell",
  });
  const effect = createTestEffect({ id: "graveyard_effect", speed: 2 });
  placeCard(player, "graveyard", card);

  const link = await publishPreparedLink(chain, {
    card,
    controller: player,
    effect,
    activationZone: "graveyard",
    activationContext: {
      sourceZone: "graveyard",
      activationZone: "graveyard",
    },
  });

  assert.equal(
    link.activationKind,
    CHAIN_ACTIVATION_KINDS.SPELL_TRAP_EFFECT,
  );
  assert.deepEqual(
    trace.events.map((entry) => entry.eventName),
    ["effect_activated"],
  );
});

test("[CS-05] resposta a ativação de Spell Card rejeita mera ativação de efeito", () => {
  for (const activationZone of ["spellTrap", "graveyard"]) {
    const { chain, player } = createChainHarness();
    const source = createTestCard({
      name: `Spell effect from ${activationZone}`,
      cardKind: "spell",
      subtype: activationZone === "spellTrap" ? "continuous" : "normal",
    });
    placeCard(player, activationZone, source);
    chain.addToChain(
      chain.createPreparedActivation({
        card: source,
        controller: player,
        effect: createTestEffect({ id: "source_effect", speed: 2 }),
        activationZone,
        activationContext: {
          sourceZone: activationZone,
          activationZone,
          sourceWasFacedown: false,
        },
        committed: true,
        costsPaid: true,
      }),
    );

    const responseContext = chain.getCurrentChainActivationContext({});
    const result = chain.canActivateInChain(
      createTestEffect({
        id: "card_activation_only",
        speed: 2,
        canRespondTo: ["card_activation"],
      }),
      createTestCard({ cardKind: "trap", subtype: "normal" }),
      responseContext,
    );

    assert.equal(responseContext.type, "effect_activation");
    assert.equal(result.ok, false);
    assert.match(result.reason, /card_activation/);
  }
});

test("ativação real de Spell Card publica uma ativação de carta e uma de efeito", async () => {
  const { chain, player, trace } = createChainHarness();
  const card = createTestCard({
    name: "Spell activated from hand",
    cardKind: "spell",
  });
  const effect = createTestEffect({ id: "on_activate", speed: 1 });
  placeCard(player, "hand", card);

  const link = await publishPreparedLink(chain, {
    card,
    controller: player,
    effect,
    activationZone: "spellTrap",
    activationContext: {
      fromHand: true,
      sourceZone: "hand",
      activationZone: "spellTrap",
    },
  });

  assert.equal(
    link.activationKind,
    CHAIN_ACTIVATION_KINDS.SPELL_TRAP_CARD,
  );
  assert.deepEqual(
    trace.events.map((entry) => entry.eventName),
    ["spell_activated", "effect_activated"],
  );
  assert.ok(
    trace.events.every(
      (entry) =>
        entry.payload.chainId === link.chainId &&
        entry.payload.linkId === link.linkId,
    ),
  );
});
