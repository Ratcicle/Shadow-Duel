import test from "node:test";
import assert from "node:assert/strict";

import {
  handleNegateActivation,
  handleNegateEffect,
} from "../../src/core/actionHandlers/negation.js";
import {
  createChainHarness,
  createTestCard,
  createTestEffect,
  placeCard,
} from "./helpers/chainHarness.js";

// Official baseline: Rulebook v10 and official Skill Drain card text.
// https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=5740&ope=2&request_locale=ae

function addMonsterEffectLink(chain, player, name, effectId) {
  return chain.addToChain(
    chain.createPreparedActivation({
      card: createTestCard({ name }),
      controller: player,
      effect: createTestEffect({ id: effectId, speed: 2, isQuickEffect: true }),
      activationZone: "field",
      committed: true,
      costsPaid: true,
    }),
  );
}

test("[CS-06] negar ativação difere de negar somente o efeito", async () => {
  const activationHarness = createChainHarness();
  const activationLink = addMonsterEffectLink(
    activationHarness.chain,
    activationHarness.player,
    "Activation target",
    "activation_target",
  );
  const responseContext =
    activationHarness.chain.getCurrentChainActivationContext({});

  await handleNegateActivation(
    {},
    {
      source: createTestCard({ name: "Negator" }),
      player: activationHarness.bot,
      activationContext: { context: responseContext },
      actionContext: responseContext,
    },
    {},
    { game: activationHarness.game },
  );

  assert.equal(activationLink.activationNegated, true);
  assert.equal(activationLink.effectNegated, false);
  assert.equal(activationLink.activationAttempt.activationNegated, true);

  const effectHarness = createChainHarness();
  const effectLink = addMonsterEffectLink(
    effectHarness.chain,
    effectHarness.player,
    "Effect target",
    "effect_target",
  );
  const effectResponseContext =
    effectHarness.chain.getCurrentChainActivationContext({});
  await handleNegateEffect(
    {},
    {
      source: createTestCard({ name: "Effect negator" }),
      player: effectHarness.bot,
      activationContext: { context: effectResponseContext },
      actionContext: effectResponseContext,
    },
    {},
    { game: effectHarness.game },
  );

  assert.equal(effectLink.activationNegated, false);
  assert.equal(effectLink.effectNegated, true);
  assert.equal(effectLink.activationAttempt.activationNegated, false);
});

test("[CS-06] destruir a fonte não nega implicitamente o elo", async () => {
  const { chain, game, player } = createChainHarness();
  const source = createTestCard({ name: "Destroyed source" });
  placeCard(player, "field", source);
  const link = chain.addToChain(
    chain.createPreparedActivation({
      card: source,
      controller: player,
      effect: createTestEffect({ id: "source_effect", speed: 2 }),
      activationZone: "field",
      committed: true,
      costsPaid: true,
    }),
  );

  await game.moveCard(source, player, "graveyard", {
    fromZone: "field",
    wasDestroyed: true,
  });

  assert.equal(source.locationVersion, 1);
  assert.equal(link.sourceAtActivation.locationVersion, 0);
  assert.equal(link.latestSourceLocation.locationVersion, 1);
  assert.equal(link.sourceMoved, true);
  assert.equal(link.sourceDestroyed, true);
  assert.equal(link.activationNegated, false);
  assert.equal(link.effectNegated, false);
});

test("[CS-06] efeito de monstro sob Skill Drain pode ser ativado e resolve negado", async () => {
  const { chain, player, bot, trace } = createChainHarness();
  const effect = createTestEffect({
    id: "negated_on_field",
    timing: "manual",
    speed: 2,
    isQuickEffect: true,
    activationZones: ["field"],
    actions: [{ type: "must_not_apply" }],
  });
  const source = createTestCard({
    instanceId: 120,
    name: "Negated monster",
    effectsNegated: true,
    effects: [effect],
  });
  placeCard(player, "field", source);

  const candidates = chain.getActivatableCardsInChain(player, {
    type: "phase_change",
    event: "phase_end",
    player: bot,
    triggerPlayer: bot,
    openState: true,
    legalWindow: true,
  });
  assert.deepEqual(candidates.map((candidate) => candidate.effectId), [effect.id]);

  const link = chain.addToChain(
    chain.createPreparedActivation({
      card: source,
      controller: player,
      effect,
      activationZone: "field",
      committed: true,
      costsPaid: true,
    }),
  );
  const result = await chain.resolveChain();

  assert.equal(result.success, true);
  assert.equal(trace.actions.length, 0);
  assert.equal(link.activationNegated, false);
  assert.equal(link.effectNegated, true);
  assert.equal(link.effectNegationReason, "continuous_effect_negation");
  assert.equal(link.resolvedWithoutEffect, true);
  assert.equal(player.field.includes(source), true);
});

test("[CS-06] Spell/Trap cuja ativação foi negada recebe o destino correto", async (t) => {
  const cases = [
    ["Normal Spell", "spell", "normal", "spellTrap"],
    ["Quick-Play Spell", "spell", "quick", "spellTrap"],
    ["Continuous Spell", "spell", "continuous", "spellTrap"],
    ["Equip Spell", "spell", "equip", "spellTrap"],
    ["Field Spell", "spell", "field", "fieldSpell"],
    ["Normal Trap", "trap", "normal", "spellTrap"],
    ["Continuous Trap", "trap", "continuous", "spellTrap"],
    ["Counter Trap", "trap", "counter", "spellTrap"],
  ];

  for (const [name, cardKind, subtype, zone] of cases) {
    await t.test(name, async () => {
      const { chain, player, trace } = createChainHarness();
      const card = createTestCard({
        instanceId: `${cardKind}:${subtype}`,
        name,
        cardKind,
        subtype,
      });
      placeCard(player, zone, card);
      const link = chain.addToChain(
        chain.createPreparedActivation({
          card,
          controller: player,
          effect: createTestEffect({
            id: `negated_${cardKind}_${subtype}`,
            speed: subtype === "counter" ? 3 : 2,
          }),
          activationZone: zone,
          activationContext: {
            sourceZone: cardKind === "spell" ? "hand" : zone,
            fromHand: cardKind === "spell",
            sourceWasFacedown: cardKind === "trap",
          },
          committed: true,
          costsPaid: true,
          activationNegated: true,
        }),
      );

      await chain.resolveChain();

      assert.equal(player.graveyard.includes(card), true);
      assert.equal(link.activationNegated, true);
      assert.equal(link.effectNegated, false);
      assert.equal(trace.moves.length, 1);
      assert.equal(
        trace.moves[0].options.contextLabel,
        "negated_activation_cleanup",
      );
      assert.equal(trace.moves[0].options.linkId, link.linkId);
    });
  }
});
test("[CS-12] limite use e limite activate divergem quando a ativação é negada", () => {
  const { chain, game, player } = createChainHarness();
  const useEffect = createTestEffect({
    id: "use_limit",
    oncePerTurn: true,
    oncePerTurnName: "use_limit",
    usagePolicy: "use",
  });
  const activateEffect = createTestEffect({
    id: "activate_limit",
    oncePerTurn: true,
    oncePerTurnName: "activate_limit",
    usagePolicy: "activate",
  });
  const useCard = createTestCard({ name: "Use policy", effects: [useEffect] });
  const activateCard = createTestCard({
    name: "Activate policy",
    effects: [activateEffect],
  });

  const useLink = chain.addToChain(
    chain.createPreparedActivation({
      card: useCard,
      controller: player,
      effect: useEffect,
      activationZone: "field",
      committed: true,
      costsPaid: true,
    }),
  );
  const activateLink = chain.addToChain(
    chain.createPreparedActivation({
      card: activateCard,
      controller: player,
      effect: activateEffect,
      activationZone: "field",
      committed: true,
      costsPaid: true,
    }),
  );

  assert.equal(game.canUseOncePerTurn(useCard, player, useEffect).ok, false);
  assert.equal(
    chain.checkActivationUsage(activateCard, player, activateEffect).ok,
    false,
    "a reserva deve impedir uma segunda ativação antes da resolução",
  );

  chain.markChainLinkActivationNegated(useLink.linkId);
  chain.markChainLinkActivationNegated(activateLink.linkId);
  chain.settleUsageForChainLink(useLink);
  chain.settleUsageForChainLink(activateLink);

  assert.equal(game.canUseOncePerTurn(useCard, player, useEffect).ok, false);
  assert.equal(
    game.canUseOncePerTurn(activateCard, player, activateEffect).ok,
    true,
  );
  assert.equal(useLink.usageReservation.status, "consumed");
  assert.equal(activateLink.usageReservation.status, "released");
});

test("limite activate permanece consumido se apenas o efeito for negado", () => {
  const { chain, game, player } = createChainHarness();
  const effect = createTestEffect({
    id: "effect_negated_limit",
    oncePerTurn: true,
    usagePolicy: "activate",
  });
  const card = createTestCard({ effects: [effect] });
  const link = chain.addToChain(
    chain.createPreparedActivation({
      card,
      controller: player,
      effect,
      activationZone: "field",
      committed: true,
      costsPaid: true,
    }),
  );

  chain.markChainLinkEffectNegated(link.linkId);
  chain.settleUsageForChainLink(link);

  assert.equal(link.activationNegated, false);
  assert.equal(link.usageReservation.status, "consumed");
  assert.equal(game.canUseOncePerTurn(card, player, effect).ok, false);
});

test("resolução registra uma política explícita exatamente uma vez", async () => {
  const { chain, game, player } = createChainHarness();
  const effect = createTestEffect({
    id: "single_usage_registration",
    oncePerTurn: true,
    oncePerTurnLimit: 2,
    usagePolicy: "activate",
  });
  const card = createTestCard({ effects: [effect] });
  placeCard(player, "field", card);
  const link = chain.addToChain(
    chain.createPreparedActivation({
      card,
      controller: player,
      effect,
      activationZone: "field",
      committed: true,
      costsPaid: true,
    }),
  );

  const result = await chain.resolveChainLink(link);

  assert.equal(result.success, true);
  assert.equal(link.usageReservation.status, "consumed");
  assert.deepEqual(game.canUseOncePerTurn(card, player, effect), {
    ok: true,
    used: 1,
    limit: 2,
    remaining: 1,
  });
});

test("resolução sem efeito não libera uma reserva activate", async () => {
  const { chain, game, player } = createChainHarness();
  const effect = createTestEffect({
    id: "no_effect_usage",
    oncePerTurn: true,
    usagePolicy: "activate",
    targets: [
      {
        id: "missing",
        owner: "opponent",
        zone: "field",
        count: { min: 1, max: 1 },
      },
    ],
  });
  const card = createTestCard({ effects: [effect] });
  placeCard(player, "field", card);
  const link = chain.addToChain(
    chain.createPreparedActivation({
      card,
      controller: player,
      effect,
      activationZone: "field",
      committed: true,
      costsPaid: true,
      targetSelections: {},
    }),
  );

  const result = await chain.resolveChainLink(link);

  assert.equal(result.resolvedWithoutEffect, true);
  assert.equal(link.usageReservation.status, "consumed");
  assert.equal(game.canUseOncePerTurn(card, player, effect).ok, false);
});

test("reserva activate cobre limites maiores e oncePerDuel", () => {
  const { chain, player } = createChainHarness();
  const effect = createTestEffect({
    id: "duel_limit",
    oncePerDuel: true,
    oncePerDuelLimit: 2,
    usagePolicy: "activate",
  });
  const firstCard = createTestCard({ instanceId: 120, effects: [effect] });
  const secondCard = createTestCard({ instanceId: 121, effects: [effect] });
  const thirdCard = createTestCard({ instanceId: 122, effects: [effect] });

  for (const card of [firstCard, secondCard]) {
    const link = chain.addToChain(
        chain.createPreparedActivation({
          card,
          controller: player,
          effect,
          activationZone: "field",
          committed: true,
          costsPaid: true,
        }),
      );
    assert.ok(link);
    assert.equal(link.usagePolicy.limit, 2);
  }

  assert.equal(chain.checkActivationUsage(thirdCard, player, effect).ok, false);
  assert.equal(
    chain.addToChain(
      chain.createPreparedActivation({
        card: thirdCard,
        controller: player,
        effect,
        activationZone: "field",
        committed: true,
        costsPaid: true,
      }),
    ),
    null,
  );

  const [firstLink, secondLink] = chain.chainStack;
  chain.settleUsageForChainLink(firstLink);
  chain.markChainLinkActivationNegated(secondLink.linkId);
  chain.settleUsageForChainLink(secondLink);

  assert.equal(chain.checkActivationUsage(thirdCard, player, effect).ok, true);
  assert.doesNotThrow(() => JSON.stringify(chain.getChainSummary()));
});

test("fonte nao persistente movida antes da resolucao ainda aplica o efeito", async () => {
  let actionCalls = 0;
  const { chain, game, player, trace } = createChainHarness({
    onActions() {
      actionCalls += 1;
    },
  });
  const card = createTestCard({
    instanceId: 140,
    name: "Moved Normal Spell",
    cardKind: "spell",
    subtype: "normal",
  });
  const effect = createTestEffect({
    id: "moved_normal_spell",
    actions: [{ type: "draw", amount: 1 }],
  });
  placeCard(player, "spellTrap", card);
  const link = chain.addToChain(
    chain.createPreparedActivation({
      card,
      controller: player,
      effect,
      activationZone: "spellTrap",
      activationContext: { sourceZone: "hand", fromHand: true },
      committed: true,
      costsPaid: true,
    }),
  );
  await game.moveCard(card, player, "graveyard", {
    fromZone: "spellTrap",
    wasDestroyed: true,
  });

  const result = await chain.resolveChain();

  assert.equal(result.success, true);
  assert.equal(actionCalls, 1);
  assert.equal(link.sourceValidity.required, false);
  assert.equal(link.sourceValidity.sameLocation, false);
  assert.equal(link.sourceMoved, true);
  assert.equal(link.sourceDestroyed, true);
  assert.equal(link.activationNegated, false);
  assert.equal(link.effectNegated, false);
  assert.equal(link.finalizationStatus, "already_moved");
  assert.equal(trace.moves.length, 1);
});

test("fonte persistente precisa permanecer face-up na mesma localizacao", async (t) => {
  const cases = [
    { name: "Continuous Spell moved", cardKind: "spell", subtype: "continuous", mutation: "move", reason: "source_wrong_zone" },
    { name: "Continuous Trap set", cardKind: "trap", subtype: "continuous", mutation: "set", reason: "source_not_face_up" },
    { name: "Equip Spell moved", cardKind: "spell", subtype: "equip", mutation: "move", reason: "source_wrong_zone" },
    { name: "Field Spell moved", cardKind: "spell", subtype: "field", mutation: "move", reason: "source_wrong_zone", zone: "fieldSpell" },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let actionCalls = 0;
      const { chain, game, player } = createChainHarness({
        onActions() {
          actionCalls += 1;
        },
      });
      const zone = entry.zone || "spellTrap";
      const card = createTestCard({
        instanceId: `persistent:${entry.subtype}`,
        name: entry.name,
        cardKind: entry.cardKind,
        subtype: entry.subtype,
      });
      placeCard(player, zone, card);
      const link = chain.addToChain(
        chain.createPreparedActivation({
          card,
          controller: player,
          effect: createTestEffect({
            id: `persistent_${entry.subtype}`,
            actions: [{ type: "must_not_apply" }],
          }),
          activationZone: zone,
          activationContext: {
            sourceZone: entry.cardKind === "trap" ? zone : "hand",
            fromHand: entry.cardKind === "spell",
            sourceWasFacedown: entry.cardKind === "trap",
          },
          committed: true,
          costsPaid: true,
        }),
      );
      if (entry.mutation === "move") {
        await game.moveCard(card, player, "graveyard", { fromZone: zone });
      } else {
        card.isFacedown = true;
      }

      const result = await chain.resolveChain();

      assert.equal(result.success, false);
      assert.equal(actionCalls, 0);
      assert.equal(link.requiresSourceAtResolution, true);
      assert.equal(link.resolvedWithoutEffect, true);
      assert.equal(link.sourceValidity.valid, false);
      assert.equal(link.sourceValidity.reason, entry.reason);
      assert.equal(link.activationNegated, false);
      assert.equal(link.effectNegated, false);
    });
  }
});

test("monstro deixa o campo antes da resolucao e escapa da negacao continua", async () => {
  let actionCalls = 0;
  const { chain, game, player } = createChainHarness({
    onActions() {
      actionCalls += 1;
    },
  });
  const effect = createTestEffect({
    id: "leaves_skill_drain",
    timing: "manual",
    speed: 2,
    isQuickEffect: true,
    activationZones: ["field"],
    actions: [{ type: "draw", amount: 1 }],
  });
  const card = createTestCard({
    instanceId: 145,
    name: "Escaping monster",
    effectsNegated: true,
    effects: [effect],
  });
  placeCard(player, "field", card);
  const link = chain.addToChain(
    chain.createPreparedActivation({
      card,
      controller: player,
      effect,
      activationZone: "field",
      committed: true,
      costsPaid: true,
    }),
  );
  await game.moveCard(card, player, "graveyard", { fromZone: "field" });

  const result = await chain.resolveChain();

  assert.equal(result.success, true);
  assert.equal(actionCalls, 1);
  assert.equal(link.sourceValidity.sameLocation, false);
  assert.equal(link.effectNegated, false);
  assert.equal(link.resolvedWithoutEffect, false);
});

test("negar somente o efeito mantem a ativacao e executa o cleanup normal", async () => {
  const { chain, player, trace } = createChainHarness();
  const card = createTestCard({
    instanceId: 146,
    name: "Effect-negated Spell",
    cardKind: "spell",
    subtype: "normal",
  });
  placeCard(player, "spellTrap", card);
  const link = chain.addToChain(
    chain.createPreparedActivation({
      card,
      controller: player,
      effect: createTestEffect({
        id: "effect_negated_spell",
        actions: [{ type: "must_not_apply" }],
      }),
      activationZone: "spellTrap",
      activationContext: { sourceZone: "hand", fromHand: true },
      committed: true,
      costsPaid: true,
    }),
  );
  chain.markChainLinkEffectNegated(link.linkId, {
    negatedBy: createTestCard({ name: "Effect negator" }),
  });

  const result = await chain.resolveChain();

  assert.equal(result.success, true);
  assert.equal(link.activationNegated, false);
  assert.equal(link.effectNegated, true);
  assert.equal(link.resolvedWithoutEffect, true);
  assert.equal(player.graveyard.includes(card), true);
  assert.deepEqual(trace.actions, []);
  assert.equal(trace.moves.length, 1);
  assert.equal(trace.moves[0].options.contextLabel, "post_chain_cleanup");
});
