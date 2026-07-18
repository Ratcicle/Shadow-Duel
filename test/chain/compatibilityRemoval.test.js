import assert from "node:assert/strict";
import test from "node:test";

import * as chainFacade from "../../src/core/ChainSystem.js";
import Game from "../../src/core/Game.js";
import NullChainSystem from "../../src/core/NullChainSystem.js";
import { cardDatabase, cardDatabaseByName } from "../../src/data/cards.js";
import { genericCards } from "../../src/data/cards/generic.js";
import { createDamageStepTransaction } from "../../src/core/game/combat/damageStep.js";
import {
  SUMMON_ORIGINS,
  createPreparedSummon,
} from "../../src/core/game/summon/transaction.js";
import {
  createChainHarness,
  createTestCard,
  createTestEffect,
  placeCard,
} from "./helpers/chainHarness.js";

// Phase 9 freezes the canonical contracts established from the official
// Rulebook, Fast Effect Timing chart and Damage Step rules cited by the
// behavior-specific suites. These regressions ensure removed adapters cannot
// silently become a second rules path again.

test("Fase 9 remove aliases de PreparedActivation e Chain Link", () => {
  const { chain, player } = createChainHarness();
  const card = createTestCard({ name: "Canonical source" });
  const effect = createTestEffect({ id: "canonical_effect" });
  placeCard(player, "field", card);

  assert.throws(
    () =>
      chain.createPreparedActivation({
        card,
        controller: player,
        effect,
        activationZone: "field",
        player: { id: "removed-player" },
        zone: "hand",
        activationType: "removed",
        negated: true,
        selections: { removed: [card] },
      }),
    /contains removed fields/,
  );
  const prepared = chain.createPreparedActivation({
    card,
    controller: player,
    effect,
    activationZone: "field",
    committed: true,
    costsPaid: true,
  });
  const link = chain.addToChain(prepared);

  for (const value of [prepared, link, link.activationAttempt]) {
    assert.equal(Object.hasOwn(value, "player"), false);
    assert.equal(Object.hasOwn(value, "zone"), false);
    assert.equal(Object.hasOwn(value, "activationType"), false);
    assert.equal(Object.hasOwn(value, "negated"), false);
    assert.equal(Object.hasOwn(value, "selections"), false);
  }
  assert.equal(link.controller, player);
  assert.equal(link.activationZone, "field");
  assert.equal(link.activationNegated, false);
  assert.deepEqual(link.costSelections, {});
  assert.deepEqual(link.targetSelections, {});
  assert.deepEqual(link.resolutionSelections, {});
});

test("Fase 9 expõe somente os pontos de entrada canônicos", () => {
  const ChainSystem = chainFacade.default;
  assert.equal("CHAIN_CONTEXTS" in chainFacade, false);
  assert.equal(Game.prototype.queuePendingChainEvent, undefined);
  assert.equal(Game.prototype.flushPendingChainEvents, undefined);
  assert.equal(Game.prototype.resolveSummonOrigin, undefined);
  assert.equal(Game.prototype.finishCombat, undefined);
  assert.equal(Game.prototype.applyBattleDestroyEffect, undefined);
  assert.equal(ChainSystem.prototype.getBotSelectionsForEffect, undefined);
  assert.equal(ChainSystem.prototype.selectBestTargets, undefined);
  assert.equal(NullChainSystem.prototype.getCurrentChainLength, undefined);
  assert.equal(NullChainSystem.prototype.getCurrentChainLevel, undefined);
  assert.equal(NullChainSystem.prototype.getLastLink, undefined);
});

test("cartas exportadas já contêm os metadados canônicos sem clonagem", () => {
  const naturalSelection = genericCards.find(
    (card) => card.name === "Natural Selection",
  );
  assert.equal(cardDatabaseByName.get("Natural Selection"), naturalSelection);

  const effects = cardDatabase.flatMap((card) => card.effects || []);
  assert.equal(
    effects.some(
      (effect) =>
        ["ignition", "manual"].includes(effect.timing) &&
        (!Array.isArray(effect.activationZones) ||
          effect.requireZone !== undefined),
    ),
    false,
  );
  assert.equal(
    effects.some(
      (effect) =>
        (effect.oncePerTurn || effect.oncePerDuel) &&
        !["use", "activate"].includes(effect.usagePolicy),
    ),
    false,
  );
  assert.equal(
    effects.some((effect) => effect.allowDamageStepActivation !== undefined),
    false,
  );
  assert.equal(
    effects.some((effect) => effect.manualActivationOnly !== undefined),
    false,
  );
});

test("efeito limitado sem usagePolicy falha em vez de usar fallback", () => {
  const { chain, player } = createChainHarness();
  const effect = createTestEffect({
    id: "missing_policy",
    oncePerTurn: true,
    usagePolicy: undefined,
  });
  const card = createTestCard({ effects: [effect] });
  placeCard(player, "field", card);

  const result = chain.checkActivationUsage(card, player, effect);
  assert.equal(result.ok, false);
  assert.equal(result.code, "USAGE_POLICY_REQUIRED");
});

test("PreparedSummon não interpreta nomes antigos", () => {
  const card = createTestCard({ name: "Summon source" });
  assert.throws(
    () =>
      createPreparedSummon.call(
        { getOpponent: () => null },
        {
          card,
          player: { id: "removed-player" },
          fromZone: "hand",
          method: "normal",
          summonOrigin: SUMMON_ORIGINS.PROCEDURE,
        },
      ),
    /contains removed fields/,
  );
});

test("Damage Step rejeita target removido", () => {
  const attacker = createTestCard({ owner: "player", name: "Attacker" });
  const legacyTarget = createTestCard({ owner: "bot", name: "Defender" });
  const player = { id: "player" };
  const bot = { id: "bot" };
  const game = {
    player,
    bot,
    nextDamageStepId: 1,
    activeDamageStepTransaction: null,
    getOpponent: (owner) => (owner === player ? bot : player),
  };

  const result = createDamageStepTransaction.call(game, {
    attacker,
    target: legacyTarget,
    attackerOwner: player,
    defenderOwner: bot,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "removed_damage_step_target_field");
  assert.equal(game.nextDamageStepId, 1);
});

test("corrente canônica de quatro elos resolve em LIFO", async () => {
  const resolved = [];
  const { chain, player, bot } = createChainHarness({
    onActions(_actions, context) {
      resolved.push(context.source.name);
    },
  });

  for (let level = 1; level <= 4; level += 1) {
    chain.addToChain(
      chain.createPreparedActivation({
        card: createTestCard({ name: `CL${level}` }),
        controller: level % 2 === 0 ? bot : player,
        effect: createTestEffect({
          id: `chain_link_${level}`,
          speed: level === 1 ? 1 : 2,
          actions: [{ type: `resolve_${level}` }],
        }),
        activationZone: "field",
        committed: true,
        costsPaid: true,
      }),
    );
  }

  await chain.resolveChain();

  assert.deepEqual(resolved, ["CL4", "CL3", "CL2", "CL1"]);
  assert.equal(chain.getChainLength(), 0);
  assert.equal(chain.isResolving, false);
});
