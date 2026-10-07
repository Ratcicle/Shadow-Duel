import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { cardDatabaseById } from "../../src/data/cards.js";
import type ChainSystem from "../../src/core/ChainSystem.js";
import type { CardAction } from "../../src/core/contracts/actions.js";
import type { ChainPlayer } from "../../src/core/contracts/chainRuntime.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import { objectResult, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, runtimeCard } from "../helpers/game.js";

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

function addMonsterEffectLink(
  chain: ChainSystem,
  player: ChainPlayer,
  name: string,
  effectId: string,
) {
  return required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: createTestCard({ name }),
        controller: player,
        effect: createTestEffect({
          id: effectId,
          speed: 2,
          isQuickEffect: true,
        }),
        activationZone: "field",
        committed: true,
        costsPaid: true,
      }),
    ),
  );
}

for (const negation of ["negate_activation", "negate_summon_or_activation_and_destroy"] as const) {
  for (const protection of ["absent", "active", "negated", "facedown", "wrong_zone"] as const) {
    test(`[CS-03] ${negation} respects Crash Town with source ${protection}`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false });
      t.after(() => game.dispose());
      game.turn = "player";
      game.phase = "main1";
      game.turnCounter = 4;
      game.player.controllerType = game.bot.controllerType = "human";
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
      const make = (id: number, owner = game.player.id) => new Card(required(cardDatabaseById.get(id)), owner);
      const funeral = make(458);
      const gunslinger = make(451);
      const crash = make(462);
      const bahamut = make(275, game.bot.id);
      game.player.hand.push(funeral);
      game.player.deck.push(gunslinger);
      bahamut.properSummonEstablished = true;
      bahamut.properSummonProcedure = "graveyard_banish_fusion";
      if (negation === "negate_activation") {
        // The catalog has no plain negate_activation effect. This fixture keeps
        // Bahamut's response contract and substitutes only the handler under test.
        bahamut.effects = bahamut.effects.map(effect => ({ ...effect, actions: [{ type: negation }] }));
      }
      if (protection === "wrong_zone") placeFieldCards(game.player.spellTrap, crash);
      else if (protection !== "absent") game.player.fieldSpell = crash;
      crash.isFacedown = protection === "facedown";
      if (protection === "negated") {
        const singularity = make(517, game.bot.id);
        placeFieldCards(game.bot.field, singularity);
        const effect = required(singularity.effects.find(effect => effect.id === "tech_zero_final_singularity_synchro_negate_all"));
        const applied = await game.effectEngine.applyActions(required(effect.actions), {
          source: singularity, effect, player: game.bot, opponent: game.player,
        }, {});
        assert.equal(applied.success, true);
        assert.equal(crash.effectsNegated, true);
        await game.moveCard(singularity, game.bot, "graveyard", { fromZone: "field", awaitCardMovedEvent: true });
        assert.equal(crash.effectsNegated, true);
      }
      placeFieldCards(game.bot.field, bahamut);
      const completed: { effectId: string | null | undefined; outcome: unknown }[] = [];
      const funeralMoves: { fromZone: unknown; toZone: unknown; destroyed: boolean }[] = [];
      game.on("chain_link_resolution", event => {
        if (event.stage === "completed") completed.push({ effectId: event.effectId, outcome: event.outcome });
      });
      game.on("card_moved", event => {
        if (event.card === funeral) funeralMoves.push({ fromZone: event.fromZone, toZone: event.toZone, destroyed: event.wasDestroyed === true });
      });
      let responded = false;
      game.ui.showChainResponseModal = async candidates => {
        const candidate = !responded && candidates.find(candidate => candidate.card === bahamut);
        if (!candidate) return null;
        responded = true;
        return candidate;
      };
      await game.tryActivateSpell(funeral, 0, { funeral_at_sunset_sent_monster: [gunslinger] }, { owner: game.player });

      const protectedActivation = protection === "active";
      assert.equal(responded, true);
      assert.equal(game.player.deck.includes(gunslinger), !protectedActivation);
      assert.equal(game.player.graveyard.includes(gunslinger), protectedActivation);
      assert.equal(game.player.graveyard.includes(funeral), true);
      assert.equal(game.bot.field.includes(bahamut), true);
      assert.deepEqual(completed, [
        { effectId: "supreme_bahamut_dragon_negate", outcome: "success" },
        { effectId: "funeral_at_sunset", outcome: protectedActivation ? "success" : "activation_negated" },
      ]);
      assert.deepEqual(funeralMoves.filter(move => move.toZone === "graveyard"), [{
        fromZone: "spellTrap", toZone: "graveyard",
        destroyed: !protectedActivation && negation === "negate_summon_or_activation_and_destroy",
      }]);
    });
  }
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
    { type: "negate_activation" },
    unsafeFixture<Parameters<typeof handleNegateActivation>[1]>(
      {
        source: createTestCard({ name: "Negator" }),
        player: activationHarness.bot,
        activationContext: { context: responseContext },
        actionContext: responseContext,
      },
      "Negation fixture bridges the minimal Chain context without LP or card model methods.",
    ),
    {},
    unsafeFixture<Parameters<typeof handleNegateActivation>[3]>(
      { game: activationHarness.game },
      "Negation handler uses the minimal Chain game fixture; other engine methods must not run.",
    ),
  );

  assert.equal(required(activationLink.activationNegated), true);
  assert.equal(required(activationLink.effectNegated), false);
  assert.equal(
    required(activationLink.activationAttempt.activationNegated),
    true,
  );

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
    { type: "negate_effect" },
    unsafeFixture<Parameters<typeof handleNegateEffect>[1]>(
      {
        source: createTestCard({ name: "Effect negator" }),
        player: effectHarness.bot,
        activationContext: { context: effectResponseContext },
        actionContext: effectResponseContext,
      },
      "Negation fixture bridges the minimal Chain context without LP or card model methods.",
    ),
    {},
    unsafeFixture<Parameters<typeof handleNegateEffect>[3]>(
      { game: effectHarness.game },
      "Negation handler uses the minimal Chain game fixture; other engine methods must not run.",
    ),
  );

  assert.equal(required(effectLink.activationNegated), false);
  assert.equal(required(effectLink.effectNegated), true);
  assert.equal(required(effectLink.activationAttempt.activationNegated), false);
});

test("[CS-06] destruir a fonte não nega implicitamente o elo", async () => {
  const { chain, game, player } = createChainHarness();
  const source = createTestCard({ name: "Destroyed source" });
  placeCard(player, "field", source);
  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: source,
        controller: player,
        effect: createTestEffect({ id: "source_effect", speed: 2 }),
        activationZone: "field",
        committed: true,
        costsPaid: true,
      }),
    ),
  );

  await game.moveCard(source, player, "graveyard", {
    fromZone: "field",
    wasDestroyed: true,
  });

  assert.equal(source.locationVersion, 1);
  assert.equal(required(link.sourceAtActivation).locationVersion, 0);
  assert.equal(required(link.latestSourceLocation).locationVersion, 1);
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
    actions: [
      unsafeFixture<CardAction>(
        { type: "must_not_apply" },
        "Synthetic action intercepted by the test harness; never dispatched to the action registry.",
      ),
    ],
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
  assert.deepEqual(
    candidates.map((candidate) => candidate.effectId),
    [effect.id],
  );

  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: source,
        controller: player,
        effect,
        activationZone: "field",
        committed: true,
        costsPaid: true,
      }),
    ),
  );
  const result = objectResult(await chain.resolveChain());

  assert.ok(result.success === true);
  assert.equal(required(trace.actions).length, 0);
  assert.equal(link.activationNegated, false);
  assert.equal(link.effectNegated, true);
  assert.equal(link.effectNegationReason, "continuous_effect_negation");
  assert.equal(link.resolvedWithoutEffect, true);
  assert.equal(player.field.includes(source), true);
});

test("negação contínua alcança efeitos face-up de cada zona sem devolver o custo ou negar a ativação", async (t) => {
  const cases = [
    ["Monster", "monster", null, "field"],
    ["Equip Spell", "spell", "equip", "spellTrap"],
    ["Continuous Spell", "spell", "continuous", "spellTrap"],
    ["Continuous Trap", "trap", "continuous", "spellTrap"],
    ["Field Spell", "spell", "field", "fieldSpell"],
  ] as const;

  for (const [name, cardKind, subtype, zone] of cases) {
    await t.test(name, async (caseContext) => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
      caseContext.after(() => game.dispose());
      game.player.controllerType = "ai";
      game.bot.controllerType = "ai";
      game.disablePresentationDelays = true;
      const effect = {
        id: "negated_faceup_effect",
        timing: "manual",
        speed: 2,
        isQuickEffect: true,
        activationZones: [zone],
        oncePerTurn: true,
        usagePolicy: "activate",
        activationCosts: [{ type: "pay_lp", player: "self", amount: 400 }],
        actions: [{ type: "damage", player: "opponent", amount: 300 }],
      } satisfies EffectDefinition;
      const source = runtimeCard({
        name,
        cardKind,
        subtype,
        effects: [effect],
        effectsNegated: true,
      }, game.player.id);
      if (zone === "fieldSpell") game.player.fieldSpell = source;
      else placeFieldCards(game.player[zone], source);
      const prepared = game.chainSystem.createPreparedActivation({
        card: source,
        controller: game.player,
        effect,
        activationZone: zone,
        committed: true,
      });
      const cost = await game.chainSystem.payActivationCosts(prepared);
      assert.equal(cost.success, true);
      assert.equal(game.player.lp, 7600);
      const link = game.chainSystem.addToChain(prepared);
      assert.ok(link);

      const result = objectResult(await game.chainSystem.resolveChain());

      assert.equal(result.success, true);
      assert.equal(game.bot.lp, 8000, "The negated damage action must not resolve.");
      assert.equal(game.player.lp, 7600, "Effect negation must not refund activation costs.");
      assert.equal(link.activationNegated, false);
      assert.equal(link.effectNegated, true);
      assert.equal(link.effectNegationReason, "continuous_effect_negation");
      assert.equal(required(link.usageReservation).status, "consumed");
      assert.equal(game.chainSystem.determineCardZone(source, game.player), zone);
    });
  }
});

test("negação da nova permanência não alcança o elo criado antes de a fonte sair e voltar", async (t) => {
  const cases = [
    ["Monster", "monster", null, "field"],
    ["Normal Spell", "spell", "normal", "spellTrap"],
    ["Normal Trap", "trap", "normal", "spellTrap"],
  ] as const;

  for (const [name, cardKind, subtype, zone] of cases) {
    await t.test(name, async () => {
      const { chain, game, player, trace } = createChainHarness();
      const card = createTestCard({ name, cardKind, subtype, effectsNegated: true });
      placeCard(player, zone, card);
      const link = required(chain.addToChain(chain.createPreparedActivation({
        card,
        controller: player,
        effect: createTestEffect({ actions: [{ type: "draw", amount: 1 }] }),
        activationZone: zone,
        committed: true,
        costsPaid: true,
      })));
      await game.moveCard(card, player, "graveyard", { fromZone: zone });
      await game.moveCard(card, player, zone, { fromZone: "graveyard" });

      const result = objectResult(await chain.resolveChain());

      assert.equal(result.success, true);
      assert.equal(trace.actions.length, 1);
      assert.equal(required(link.sourceValidity).sameLocation, false);
      assert.equal(link.activationNegated, false);
      assert.equal(link.effectNegated, false);
      const context = required(trace.actions[0]).ctx.activationContext;
      assert.equal(context?.sourceAtActivation?.locationVersion, 0);
      assert.equal(context?.sourceAtActivation?.zone, zone);
      assert.equal(context?.sourceAtActivation?.cardInstanceId, card.instanceId);
    });
  }
});

test("negação contínua revalida face e permanência depois da apresentação da ativação", async (t) => {
  for (const leavesField of [false, true]) {
    await t.test(leavesField ? "leaves and returns" : "revealed on the field", async () => {
      const { chain, game, player, trace } = createChainHarness();
      const card = createTestCard({
        name: "Source during activation presentation",
        cardKind: "spell",
        subtype: "normal",
        isFacedown: true,
        effectsNegated: true,
      });
      placeCard(player, "spellTrap", card);
      const link = required(chain.addToChain(chain.createPreparedActivation({
        card,
        controller: player,
        effect: createTestEffect({ actions: [{ type: "draw", amount: 1 }] }),
        activationZone: "spellTrap",
        committed: true,
        costsPaid: true,
      })));
      game.presentSpellTrapActivationFlip = async () => {
        if (leavesField) {
          await game.moveCard(card, player, "graveyard", { fromZone: "spellTrap" });
          await game.moveCard(card, player, "spellTrap", { fromZone: "graveyard" });
        }
        card.isFacedown = false;
      };

      const result = objectResult(await chain.resolveChain());

      assert.equal(result.success, true);
      assert.equal(trace.actions.length, leavesField ? 1 : 0);
      assert.equal(link.effectNegated, !leavesField);
    });
  }
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
  ] as const;

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
      const link = required(
        chain.addToChain(
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
        ),
      );

      await chain.resolveChain();

      assert.equal(player.graveyard.includes(card), true);
      assert.equal(link.activationNegated, true);
      assert.equal(link.effectNegated, false);
      assert.equal(trace.moves.length, 1);
      assert.equal(
        required(trace.moves[0]).options.contextLabel,
        "negated_activation_cleanup",
      );
      assert.equal(required(trace.moves[0]).options.linkId, link.linkId);
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

  const useLink = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: useCard,
        controller: player,
        effect: useEffect,
        activationZone: "field",
        committed: true,
        costsPaid: true,
      }),
    ),
  );
  const activateLink = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card: activateCard,
        controller: player,
        effect: activateEffect,
        activationZone: "field",
        committed: true,
        costsPaid: true,
      }),
    ),
  );

  assert.ok(game.canUseOncePerTurn(useCard, player, useEffect).ok === false);
  assert.equal(
    chain.checkActivationUsage(activateCard, player, activateEffect).ok,
    false,
    "a reserva deve impedir uma segunda ativação antes da resolução",
  );

  chain.markChainLinkActivationNegated(useLink.linkId);
  chain.markChainLinkActivationNegated(activateLink.linkId);
  chain.settleUsageForChainLink(useLink);
  chain.settleUsageForChainLink(activateLink);

  assert.ok(game.canUseOncePerTurn(useCard, player, useEffect).ok === false);
  assert.ok(
    game.canUseOncePerTurn(activateCard, player, activateEffect).ok === true,
  );
  assert.equal(required(useLink.usageReservation).status, "consumed");
  assert.equal(required(activateLink.usageReservation).status, "released");
});

test("limite activate permanece consumido se apenas o efeito for negado", () => {
  const { chain, game, player } = createChainHarness();
  const effect = createTestEffect({
    id: "effect_negated_limit",
    oncePerTurn: true,
    usagePolicy: "activate",
  });
  const card = createTestCard({ effects: [effect] });
  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card,
        controller: player,
        effect,
        activationZone: "field",
        committed: true,
        costsPaid: true,
      }),
    ),
  );

  chain.markChainLinkEffectNegated(link.linkId);
  chain.settleUsageForChainLink(link);

  assert.equal(link.activationNegated, false);
  assert.equal(required(link.usageReservation).status, "consumed");
  assert.ok(game.canUseOncePerTurn(card, player, effect).ok === false);
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
  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card,
        controller: player,
        effect,
        activationZone: "field",
        committed: true,
        costsPaid: true,
      }),
    ),
  );

  const result = required(await chain.resolveChainLink(link));

  assert.ok(result.success === true);
  assert.equal(required(link.usageReservation).status, "consumed");
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
  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card,
        controller: player,
        effect,
        activationZone: "field",
        committed: true,
        costsPaid: true,
        targetSelections: {},
      }),
    ),
  );

  const result = required(await chain.resolveChainLink(link));

  assert.equal(result.resolvedWithoutEffect, true);
  assert.equal(required(link.usageReservation).status, "consumed");
  assert.ok(game.canUseOncePerTurn(card, player, effect).ok === false);
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

  for (const card of [firstCard, secondCard] as const) {
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

  assert.ok(chain.checkActivationUsage(thirdCard, player, effect).ok === false);
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
  assert.ok(firstLink);
  assert.ok(secondLink);
  chain.settleUsageForChainLink(firstLink);
  chain.markChainLinkActivationNegated(secondLink.linkId);
  chain.settleUsageForChainLink(secondLink);

  assert.ok(chain.checkActivationUsage(thirdCard, player, effect).ok === true);
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
  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card,
        controller: player,
        effect,
        activationZone: "spellTrap",
        activationContext: { sourceZone: "hand", fromHand: true },
        committed: true,
        costsPaid: true,
      }),
    ),
  );
  await game.moveCard(card, player, "graveyard", {
    fromZone: "spellTrap",
    wasDestroyed: true,
  });

  const result = objectResult(await chain.resolveChain());

  assert.ok(result.success === true);
  assert.equal(actionCalls, 1);
  assert.equal(required(link.sourceValidity).required, false);
  assert.equal(required(link.sourceValidity).sameLocation, false);
  assert.equal(link.sourceMoved, true);
  assert.equal(link.sourceDestroyed, true);
  assert.equal(link.activationNegated, false);
  assert.equal(link.effectNegated, false);
  assert.equal(link.finalizationStatus, "already_moved");
  assert.equal(trace.moves.length, 1);
});

test("fonte persistente precisa permanecer face-up na mesma localizacao", async (t) => {
  const cases = [
    {
      name: "Continuous Spell moved",
      cardKind: "spell",
      subtype: "continuous",
      mutation: "move",
      reason: "source_wrong_zone",
    },
    {
      name: "Continuous Trap set",
      cardKind: "trap",
      subtype: "continuous",
      mutation: "set",
      reason: "source_not_face_up",
    },
    {
      name: "Equip Spell moved",
      cardKind: "spell",
      subtype: "equip",
      mutation: "move",
      reason: "source_wrong_zone",
    },
    {
      name: "Field Spell moved",
      cardKind: "spell",
      subtype: "field",
      mutation: "move",
      reason: "source_wrong_zone",
      zone: "fieldSpell",
    },
  ] as const;

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      let actionCalls = 0;
      const { chain, game, player } = createChainHarness({
        onActions() {
          actionCalls += 1;
        },
      });
      const zone = "zone" in entry ? entry.zone : "spellTrap";
      const card = createTestCard({
        instanceId: `persistent:${entry.subtype}`,
        name: entry.name,
        cardKind: entry.cardKind,
        subtype: entry.subtype,
      });
      placeCard(player, zone, card);
      const link = required(
        chain.addToChain(
          chain.createPreparedActivation({
            card,
            controller: player,
            effect: createTestEffect({
              id: `persistent_${entry.subtype}`,
              actions: [
                unsafeFixture<CardAction>(
                  { type: "must_not_apply" },
                  "Synthetic action intercepted by the test harness; never dispatched to the action registry.",
                ),
              ],
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
        ),
      );
      if (entry.mutation === "move") {
        await game.moveCard(card, player, "graveyard", { fromZone: zone });
      } else {
        card.isFacedown = true;
      }

      const result = objectResult(await chain.resolveChain());

      assert.ok(result.success === false);
      assert.equal(actionCalls, 0);
      assert.equal(link.requiresSourceAtResolution, true);
      assert.equal(link.resolvedWithoutEffect, true);
      assert.equal(required(link.sourceValidity).valid, false);
      assert.equal(required(link.sourceValidity).reason, entry.reason);
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
  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card,
        controller: player,
        effect,
        activationZone: "field",
        committed: true,
        costsPaid: true,
      }),
    ),
  );
  await game.moveCard(card, player, "graveyard", { fromZone: "field" });

  const result = objectResult(await chain.resolveChain());

  assert.ok(result.success === true);
  assert.equal(actionCalls, 1);
  assert.equal(required(link.sourceValidity).sameLocation, false);
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
  const link = required(
    chain.addToChain(
      chain.createPreparedActivation({
        card,
        controller: player,
        effect: createTestEffect({
          id: "effect_negated_spell",
          actions: [
            unsafeFixture<CardAction>(
              { type: "must_not_apply" },
              "Synthetic action intercepted by the test harness; never dispatched to the action registry.",
            ),
          ],
        }),
        activationZone: "spellTrap",
        activationContext: { sourceZone: "hand", fromHand: true },
        committed: true,
        costsPaid: true,
      }),
    ),
  );
  chain.markChainLinkEffectNegated(link.linkId, {
    negatedBy: createTestCard({ name: "Effect negator" }),
  });

  const result = objectResult(await chain.resolveChain());

  assert.ok(result.success === true);
  assert.equal(link.activationNegated, false);
  assert.equal(link.effectNegated, true);
  assert.equal(link.resolvedWithoutEffect, true);
  assert.equal(player.graveyard.includes(card), true);
  assert.deepEqual(required(trace.actions), []);
  assert.equal(trace.moves.length, 1);
  assert.equal(
    required(trace.moves[0]).options.contextLabel,
    "post_chain_cleanup",
  );
});

// Preserve the approved real CL1..CL4/CL1..CL3 audit controls permanently.
for (const kinds of [
  ["negate_activation", "negate_activation"],
  ["negate_effect", "negate_activation"],
  ["negate_activation", "negate_effect"],
  ["negate_effect", "negate_effect"],
] as const) {
  test(`two independently successful negations in CL1..CL4: ${kinds.join("/")}`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 10000 });
    t.after(() => game.dispose());
    game.turn = "player"; game.phase = "main1"; game.turnCounter = 4;
    game.player.controllerType = game.bot.controllerType = "human";
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    const damageEffect = (id: string, cost: number): EffectDefinition => ({
      id, timing: "manual", activationZones: ["field"], speed: 2, isQuickEffect: true,
      activationCosts: [{ type: "pay_lp", player: "self", amount: cost }],
      actions: [{ type: "damage", player: "opponent", amount: 1000 }],
    });
    const responseEffect = (id: string, type: "negate_activation" | "negate_effect"): EffectDefinition => ({
      id, timing: "manual", activationZones: ["field"], speed: 2, isQuickEffect: true,
      canRespondTo: ["card_activation", "effect_activation"], actions: [{ type }],
    });
    const rootEffect: EffectDefinition = { ...damageEffect("root", 500), timing: "ignition", activationZones: ["field"], speed: 1, isQuickEffect: false };
    const root = runtimeCard({ name: "Audit Root", cardKind: "monster", effects: [rootEffect] }, game.player.id);
    const second = runtimeCard({ name: "Audit CL2", cardKind: "monster", effects: [responseEffect("second", kinds[0])] }, game.bot.id);
    const third = runtimeCard({ name: "Audit CL3", cardKind: "monster", effects: [damageEffect("third", 700)] }, game.player.id);
    const fourth = runtimeCard({ name: "Audit CL4", cardKind: "monster", effects: [responseEffect("fourth", kinds[1])] }, game.bot.id);
    placeFieldCards(game.player.field, root, third); placeFieldCards(game.bot.field, second, fourth);
    const queue = [second, third, fourth];
    const completed: { effectId: unknown; outcome: unknown }[] = [];
    game.on("chain_link_resolution", event => { if (event.stage === "completed") completed.push({ effectId: event.effectId, outcome: event.outcome }); });
    game.ui.showChainResponseModal = async candidates => {
      const candidate = candidates.find(candidate => candidate.card === queue[0]);
      if (candidate) { queue.shift(); return candidate; }
      return null;
    };
    await game.tryActivateMonsterEffect(root, {}, "field", game.player, { effectId: rootEffect.id });
    assert.equal(queue.length, 0);
    assert.equal(game.player.lp, 6800); assert.equal(game.bot.lp, 8000);
    assert.deepEqual(completed, [
      { effectId: "fourth", outcome: "success" },
      { effectId: "third", outcome: kinds[1] === "negate_activation" ? "activation_negated" : "effect_negated" },
      { effectId: "second", outcome: "success" },
      { effectId: "root", outcome: kinds[0] === "negate_activation" ? "activation_negated" : "effect_negated" },
    ]);
  });
}

for (const kinds of [
  ["negate_activation", "negate_activation"],
  ["negate_effect", "negate_activation"],
  ["negate_activation", "negate_effect"],
  ["negate_effect", "negate_effect"],
] as const) {
  test(`real Chain CL1/CL2/CL3 with ${kinds.join("/")}`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 10000 });
    t.after(() => game.dispose());
    game.turn = "player"; game.phase = "main1"; game.turnCounter = 4;
    game.player.controllerType = game.bot.controllerType = "human";
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    const rootEffect: EffectDefinition = { id: "root", timing: "ignition", activationZones: ["field"],
      activationCosts: [{ type: "pay_lp", player: "self", amount: 500 }],
      actions: [{ type: "damage", player: "opponent", amount: 1000 }] };
    const responseEffect = (id: string, type: "negate_activation" | "negate_effect"): EffectDefinition => ({
      id, timing: "manual", activationZones: ["field"], speed: 2, isQuickEffect: true,
      canRespondTo: ["card_activation", "effect_activation"], actions: [{ type }],
    });
    const root = runtimeCard({ name: "Audit Root", cardKind: "monster", effects: [rootEffect] }, game.player.id);
    const second = runtimeCard({ name: "Audit CL2", cardKind: "monster", effects: [responseEffect("second", kinds[0])] }, game.bot.id);
    const third = runtimeCard({ name: "Audit CL3", cardKind: "monster", effects: [responseEffect("third", kinds[1])] }, game.player.id);
    placeFieldCards(game.player.field, root, third); placeFieldCards(game.bot.field, second);
    const chosen = new Set<Card>();
    const completed: { effectId: unknown; outcome: unknown }[] = [];
    game.on("chain_link_resolution", event => { if (event.stage === "completed") completed.push({ effectId: event.effectId, outcome: event.outcome }); });
    game.ui.showChainResponseModal = async candidates => {
      const next = !chosen.has(second) ? second : !chosen.has(third) ? third : null;
      const candidate = candidates.find(candidate => candidate.card === next);
      if (candidate && next) { chosen.add(next); return candidate; }
      return null;
    };
    const result = await game.tryActivateMonsterEffect(root, {}, "field", game.player, { effectId: rootEffect.id });
    assert.equal(result.success, true);
    assert.equal(chosen.size, 2);
    assert.equal(game.player.lp, 7500); assert.equal(game.bot.lp, 7000);
    assert.deepEqual(completed, [
      { effectId: "third", outcome: "success" },
      { effectId: "second", outcome: kinds[1] === "negate_activation" ? "activation_negated" : "effect_negated" },
      { effectId: "root", outcome: "success" },
    ]);
  });
}
