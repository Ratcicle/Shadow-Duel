import test from "node:test";
import assert from "node:assert/strict";

import { cardDatabaseByName } from "../../src/data/cards.js";
import { getEffectDisplayLabel } from "../../src/ui/renderer/trapModals.js";
import {
  createChainHarness,
  createTestCard,
  createTestEffect,
  placeCard,
} from "./helpers/chainHarness.js";

// Official baseline: Fast Effect Timing and card-specific activation conditions.
// https://www.yugioh-card.com/en/play/fast-effect-timing/

function createCallOfTheHaunted() {
  const cardData = cardDatabaseByName.get("Call of the Haunted");
  assert.ok(cardData, "Call of the Haunted must exist in the card database.");
  return {
    ...structuredClone(cardData),
    isFacedown: true,
    setTurn: 1,
  };
}

function createResponseContext(bot) {
  return {
    type: "phase_change",
    event: "phase_end",
    player: bot,
    triggerPlayer: bot,
    openState: true,
    legalWindow: true,
  };
}

test("Call of the Haunted não é oferecida com o Cemitério vazio", () => {
  const { chain, player, bot } = createChainHarness({ turnCounter: 3 });
  const call = createCallOfTheHaunted();
  placeCard(player, "spellTrap", call);

  const candidates = chain.getActivatableCardsInChain(
    player,
    createResponseContext(bot),
  );

  assert.deepEqual(candidates, []);
});

test("Call of the Haunted é oferecida quando há um alvo válido", () => {
  const { chain, player, bot } = createChainHarness({ turnCounter: 3 });
  const call = createCallOfTheHaunted();
  const monster = createTestCard({ name: "Graveyard monster" });
  placeCard(player, "spellTrap", call);
  placeCard(player, "graveyard", monster);

  const candidates = chain.getActivatableCardsInChain(
    player,
    createResponseContext(bot),
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].card, call);
  assert.equal(candidates[0].effect.id, "call_of_the_haunted_activate");
  assert.equal(candidates[0].zone, "spellTrap");
});

test("[CS-07] efeito rápido de Continuous Trap face-up é descoberto", () => {
  const { chain, player, bot } = createChainHarness();
  const effect = createTestEffect({
    id: "continuous_faceup_effect",
    timing: "ignition",
    speed: 2,
    requireZone: "spellTrap",
    requireFaceup: true,
  });
  const card = createTestCard({
    instanceId: 70,
    name: "Face-up Continuous Trap",
    cardKind: "trap",
    subtype: "continuous",
    effects: [effect],
  });
  placeCard(player, "spellTrap", card);

  const candidates = chain.getActivatableCardsInChain(
    player,
    createResponseContext(bot),
  );
  assert.deepEqual(candidates.map((entry) => entry.effectId), [effect.id]);
  assert.equal(candidates[0].sourceZone, "spellTrap");
});

test("[CS-07] efeitos no Cemitério e banimento são descobertos somente quando legais", () => {
  const { chain, player, bot } = createChainHarness();
  const graveEffect = createTestEffect({
    id: "grave_only",
    timing: "manual",
    speed: 2,
    isQuickEffect: true,
    activationZones: ["graveyard"],
  });
  const banishedEffect = createTestEffect({
    id: "banished_only",
    timing: "manual",
    speed: 2,
    isQuickEffect: true,
    activationZones: ["banished"],
  });
  const graveCard = createTestCard({
    instanceId: 71,
    name: "Grave effect",
    effects: [graveEffect],
  });
  const banishedCard = createTestCard({
    instanceId: 72,
    name: "Banished effect",
    effects: [banishedEffect],
  });
  placeCard(player, "graveyard", graveCard);
  placeCard(player, "banished", banishedCard);

  const candidates = chain.getActivatableCardsInChain(
    player,
    createResponseContext(bot),
  );
  assert.deepEqual(
    candidates.map((entry) => [entry.effectId, entry.sourceZone]),
    [
      ["grave_only", "graveyard"],
      ["banished_only", "banished"],
    ],
  );

  placeCard(player, "hand", graveCard);
  placeCard(player, "graveyard", banishedCard);
  assert.deepEqual(
    chain.getActivatableCardsInChain(player, createResponseContext(bot)),
    [],
  );
});

test("efeito de Quick-Play Spell no Cemitério usa a zona declarada, não regra de Set", () => {
  const { chain, player, bot } = createChainHarness();
  const effect = createTestEffect({
    id: "quick_spell_grave",
    timing: "manual",
    speed: 2,
    activationZones: ["graveyard"],
  });
  const card = createTestCard({
    instanceId: 85,
    name: "Grave Quick-Play",
    cardKind: "spell",
    subtype: "quick",
    effects: [effect],
  });
  placeCard(player, "graveyard", card);

  const candidates = chain.getActivatableCardsInChain(
    player,
    createResponseContext(bot),
  );
  assert.deepEqual(candidates.map((entry) => entry.effectId), [effect.id]);
  assert.equal(candidates[0].sourceZone, "graveyard");
});

test("[CS-07] dois efeitos distintos da mesma carta podem ser oferecidos na mesma corrente", () => {
  const { chain, player, bot } = createChainHarness();
  const first = createTestEffect({
    id: "same_card_first",
    timing: "manual",
    speed: 2,
    isQuickEffect: true,
    requireZone: "field",
  });
  const second = createTestEffect({
    id: "same_card_second",
    timing: "manual",
    speed: 2,
    isQuickEffect: true,
    requireZone: "field",
  });
  const card = createTestCard({
    instanceId: 73,
    name: "Two effects",
    effects: [first, second],
  });
  placeCard(player, "field", card);

  const candidates = chain.getActivatableCardsInChain(
    player,
    createResponseContext(bot),
  );
  assert.deepEqual(
    candidates.map((entry) => entry.effectId),
    [first.id, second.id],
  );

  chain.addToChain(
    chain.createPreparedActivation({
      card,
      player,
      effect: first,
      activationZone: "field",
      committed: true,
      costsPaid: true,
    }),
  );
  assert.deepEqual(
    chain
      .getActivatableCardsInChain(player, createResponseContext(bot))
      .map((entry) => entry.effectId),
    [second.id],
  );
});

test("Trap da mão exige permissão declarativa e efeito negado continua descoberto", () => {
  const { chain, player, bot } = createChainHarness();
  const denied = createTestCard({
    instanceId: 74,
    name: "Denied hand Trap",
    cardKind: "trap",
    effects: [
      createTestEffect({ id: "denied", timing: "on_activate", speed: 2 }),
    ],
  });
  const allowedEffect = createTestEffect({
    id: "allowed",
    timing: "on_activate",
    speed: 2,
    activationZones: ["hand"],
  });
  const allowed = createTestCard({
    instanceId: 75,
    name: "Allowed hand Trap",
    cardKind: "trap",
    effectsNegated: true,
    effects: [allowedEffect],
  });
  placeCard(player, "hand", denied);
  placeCard(player, "hand", allowed);

  const candidates = chain.getActivatableCardsInChain(
    player,
    createResponseContext(bot),
  );
  assert.deepEqual(candidates.map((entry) => entry.card), [allowed]);
  assert.equal(candidates[0].sourceZone, "hand");
});

test("Quick-Play Spell é descoberta da mão ou setada conforme as regras padrão", () => {
  const { chain, player, bot } = createChainHarness({ turnCounter: 3 });
  const handEffect = createTestEffect({
    id: "quick_from_hand",
    timing: "on_play",
    speed: 2,
  });
  const setEffect = createTestEffect({
    id: "quick_set",
    timing: "on_play",
    speed: 2,
  });
  const handQuickPlay = createTestCard({
    instanceId: 77,
    name: "Quick from hand",
    cardKind: "spell",
    subtype: "quick",
    effects: [handEffect],
  });
  const setQuickPlay = createTestCard({
    instanceId: 78,
    name: "Set Quick-Play",
    cardKind: "spell",
    subtype: "quick",
    isFacedown: true,
    setTurn: 1,
    effects: [setEffect],
  });
  placeCard(player, "hand", handQuickPlay);
  placeCard(player, "spellTrap", setQuickPlay);

  assert.deepEqual(
    chain
      .getActivatableCardsInChain(player, createResponseContext(bot))
      .map((entry) => [entry.effectId, entry.sourceZone]),
    [
      ["quick_from_hand", "hand"],
      ["quick_set", "spellTrap"],
    ],
  );
});

test("Natural Selection real exige custo e alvo válidos na descoberta", () => {
  const { chain, player, bot } = createChainHarness();
  const naturalData = cardDatabaseByName.get("Natural Selection");
  assert.ok(naturalData);
  const natural = createTestCard({
    ...structuredClone(naturalData),
    instanceId: 79,
  });
  const opponentTarget = createTestCard({
    instanceId: 80,
    name: "Face-up opponent card",
  });
  placeCard(player, "hand", natural);
  placeCard(bot, "field", opponentTarget);

  assert.deepEqual(
    chain.getActivatableCardsInChain(player, createResponseContext(bot)),
    [],
    "a própria Natural Selection não pode pagar seu descarte",
  );

  placeCard(
    player,
    "hand",
    createTestCard({ instanceId: 81, name: "Discardable card" }),
  );
  const candidates = chain.getActivatableCardsInChain(
    player,
    createResponseContext(bot),
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].effectId, "natural_selection_activation");
});

test("Guardian Deity Visas real é candidata da mão com política use", () => {
  const { chain, game, player, bot } = createChainHarness();
  const visasData = cardDatabaseByName.get("Guardian Deity Visas");
  assert.ok(visasData);
  const visas = createTestCard({
    ...structuredClone(visasData),
    instanceId: 82,
  });
  placeCard(player, "hand", visas);

  const candidates = chain.getActivatableCardsInChain(player, {
    type: "effect_activation",
    event: "effect_activation",
    player: bot,
    triggerPlayer: bot,
    openState: true,
    legalWindow: true,
  });

  assert.equal(candidates.length, 1);
  assert.equal(
    candidates[0].effectId,
    "guardian_deity_visas_hand_negate_banish",
  );
  assert.equal(candidates[0].sourceZone, "hand");
  assert.equal(candidates[0].effect.usagePolicy, "use");
  const link = chain.addToChain(
    chain.createPreparedActivation({
      card: visas,
      player,
      effect: candidates[0].effect,
      activationZone: "hand",
      committed: true,
      costsPaid: true,
    }),
  );
  assert.equal(link.usageReservation.status, "consumed");
  assert.equal(
    game.canUseOncePerTurn(visas, player, candidates[0].effect).ok,
    false,
  );
});

test("Continuous Trap real face-up oferece seu efeito manual", () => {
  const { chain, player, bot } = createChainHarness();
  const courtData = cardDatabaseByName.get("Court of the Dead");
  assert.ok(courtData);
  const court = createTestCard({
    ...structuredClone(courtData),
    instanceId: 83,
    isFacedown: false,
  });
  placeCard(player, "spellTrap", court);
  placeCard(
    player,
    "graveyard",
    createTestCard({
      instanceId: 84,
      name: "Hollow revive target",
      archetype: "Hollow",
    }),
  );

  const candidates = chain.getActivatableCardsInChain(
    player,
    createResponseContext(bot),
  );
  assert.deepEqual(candidates.map((entry) => entry.effectId), [
    "court_of_the_dead_revive",
  ]);
});

test("rótulo do modal distingue efeitos da mesma carta", () => {
  assert.equal(
    getEffectDisplayLabel({ id: "first", activationLabel: "Primeiro efeito" }),
    "Primeiro efeito",
  );
  assert.equal(getEffectDisplayLabel({ id: "second" }), "second");
});

test("locationVersion invalida um candidato descoberto antes do commit", () => {
  const { chain, player, bot } = createChainHarness();
  const effect = createTestEffect({
    id: "moving_candidate",
    timing: "manual",
    speed: 2,
    isQuickEffect: true,
    requireZone: "field",
  });
  const card = createTestCard({ instanceId: 76, effects: [effect] });
  placeCard(player, "field", card);
  const [candidate] = chain.getActivatableCardsInChain(
    player,
    createResponseContext(bot),
  );
  card.locationVersion += 1;

  assert.deepEqual(
    chain.revalidateActivationCandidate(candidate, player, candidate.context),
    { ok: false, reason: "activation_source_version_changed" },
  );
});
