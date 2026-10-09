import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { CHAIN_ACTIVATION_KINDS, CHAIN_RESPONSE_CONTEXTS } from "../src/core/contracts/chain.js";
import type { ActivationEventPayload, FastEffectPriorityEventPayload } from "../src/core/contracts/events.js";
import type { GameOptions } from "../src/core/contracts/game.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

// Rule B: activating a face-up Field/Continuous Spell, or a Continuous Trap,
// without an activation effect is still a Card Activation. It forms an
// effectless Chain Link that can be responded to and negated.

type Seat = "player" | "bot";
const SEATS: readonly Seat[] = ["player", "bot"];

function duel(seat: Seat, options: GameOptions = {}) {
  const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0, ...options });
  game.turn = seat; game.phase = "main1"; game.turnCounter = 3; game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
  const cardActivations: ActivationEventPayload[] = [];
  const effectActivations: ActivationEventPayload[] = [];
  const priority: FastEffectPriorityEventPayload[] = [];
  const order: string[] = [];
  game.on("spell_activated", payload => { cardActivations.push(payload); order.push(`activated:${payload.card.id}`); });
  game.on("trap_activated", payload => { cardActivations.push(payload); order.push(`activated:${payload.card.id}`); });
  game.on("effect_activated", payload => { effectActivations.push(payload); });
  game.on("fast_effect_priority", payload => { priority.push(payload); });
  game.on("card_to_grave", payload => { order.push(`grave:${payload.card?.id}`); });
  return { game, owner, opponent, cardActivations, effectActivations, priority, order };
}

type Duel = ReturnType<typeof duel>;

/** The single effectless Chain Link of this card, with its response window and history entry. */
function assertCardActivationLink(d: Duel, card: Card): ActivationEventPayload {
  const published = d.cardActivations.filter(payload => payload.card === card);
  assert.equal(published.length, 1, `${card.name} activation must be published once`);
  const payload = required(published[0]);
  assert.ok(payload.chainId != null && payload.linkId != null, "the activation must own a Chain Link");
  assert.equal(payload.chainLevel, 1);
  assert.equal(payload.activationKind, CHAIN_ACTIVATION_KINDS.SPELL_TRAP_CARD);
  assert.equal(payload.responseContextType, CHAIN_RESPONSE_CONTEXTS.CARD_ACTIVATION);
  assert.equal(payload.placementOnly, true);
  assert.deepEqual(payload.effect?.actions, [], "the Chain Link has no effect to resolve");
  assert.ok(d.effectActivations.some(entry => entry.card === card && entry.chainId === payload.chainId),
    "effect_activated must publish the same Chain Link");
  assert.ok(d.priority.some(entry => entry.chainId === payload.chainId && entry.decision === "offered"),
    "a response window must open on the activation");
  const history = (d.game.cardActivationHistory?.entries || [])
    .filter(entry => entry.chainId === payload.chainId && entry.linkId === payload.linkId);
  assert.deepEqual(history.map(entry => [entry.card.id, entry.playerId]), [[card.id, d.owner.id]],
    "the turn history must carry the Chain identity");
  return payload;
}

async function activateFromHand(d: Duel, card: Card) {
  d.owner.hand.push(card);
  return d.game.tryActivateSpell(card, d.owner.hand.indexOf(card), null, { owner: d.owner });
}

async function activateFromSet(d: Duel, card: Card) {
  card.isFacedown = true; card.setTurn = card.turnSetOn = 1;
  placeFieldCards(d.owner.spellTrap, card);
  return d.game.tryActivateSpellTrapEffect(card, null, { owner: d.owner });
}

for (const seat of SEATS) {
  for (const [id, from] of [[312, "hand"], [309, "hand"], [311, "hand"], [309, "set"], [311, "set"]] as const) {
    test(`Azrath witnesses the effectless activation of ${id} from ${from} as CL2 (${seat})`, async t => {
      const d = duel(seat);
      t.after(() => d.game.dispose());
      const azrath = new Card(cardDefinition(314), d.owner.id);
      const enemy = new Card(cardDefinition(307), d.opponent.id);
      placeFieldCards(d.owner.field, azrath); placeFieldCards(d.opponent.field, enemy);
      const spell = new Card(cardDefinition(id), d.owner.id);
      const baseAtk = required(enemy.atk);
      const result = from === "hand" ? await activateFromHand(d, spell) : await activateFromSet(d, spell);
      assert.equal(result.success, true, result.reason ?? undefined);
      assert.equal(result.placementOnly, true);
      const link = assertCardActivationLink(d, spell);
      const azrathLink = required(d.effectActivations.find(entry => entry.card === azrath));
      assert.equal(azrathLink.chainId, link.chainId, "the trigger must join the activation Chain");
      assert.equal(azrathLink.chainLevel, 2);
      assert.equal(enemy.atk, baseAtk - 100);
      assert.equal(spell.isFacedown, false);
      assert.ok(spell.subtype === "field" ? d.owner.fieldSpell === spell : d.owner.spellTrap.includes(spell),
        "the activated card stays in its zone");
      assert.equal(d.owner.graveyard.includes(spell), false);
      if (id === 311) assert.equal(spell.getCounter("ink"), 0, "Ink River rejects an effectless card activation");
    });
  }

  test(`setting a Spell face-down is not an activation (${seat})`, async t => {
    const d = duel(seat);
    t.after(() => d.game.dispose());
    const azrath = new Card(cardDefinition(314), d.owner.id);
    const enemy = new Card(cardDefinition(307), d.opponent.id);
    placeFieldCards(d.owner.field, azrath); placeFieldCards(d.opponent.field, enemy);
    const set = new Card(cardDefinition(309), d.owner.id);
    d.owner.hand.push(set);
    assert.equal((await d.game.setSpellOrTrap(set, 0, d.owner)).ok, true);
    assert.equal(set.isFacedown, true);
    assert.deepEqual([d.cardActivations.length, d.effectActivations.length], [0, 0]);
    assert.deepEqual(d.game.cardActivationHistory?.entries ?? [], []);
    assert.equal(enemy.atk, 1500);
    // The control activation in the same duel proves the observers are live.
    const activated = new Card(cardDefinition(311), d.owner.id);
    assert.equal((await activateFromHand(d, activated)).success, true);
    assertCardActivationLink(d, activated);
    assert.equal(enemy.atk, 1400);
  });

  test(`Field replacement sends the old Field before the activation link (${seat})`, async t => {
    const d = duel(seat);
    t.after(() => d.game.dispose());
    const previous = new Card(cardDefinition(115), d.owner.id);
    d.owner.fieldSpell = previous;
    const library = new Card(cardDefinition(312), d.owner.id);
    assert.equal((await activateFromHand(d, library)).success, true);
    assertCardActivationLink(d, library);
    assert.equal(d.owner.fieldSpell, library);
    assert.deepEqual(d.owner.graveyard.filter(card => card === previous).length, 1);
    assert.deepEqual(d.order, ["grave:115", "activated:312"]);
  });

  test(`Tech-Zero Lab activation consumes no once-per-turn usage (${seat})`, async t => {
    const d = duel(seat);
    t.after(() => d.game.dispose());
    const lab = new Card(cardDefinition(518), d.owner.id);
    assert.equal((await activateFromHand(d, lab)).success, true);
    assertCardActivationLink(d, lab);
    const ignition = required(lab.effects.find(effect => effect.timing === "ignition"));
    assert.equal(d.game.effectEngine.checkOncePerTurn(lab, d.owner, ignition).ok, true);
    assert.equal(d.game.effectEngine.getSpellTrapActivationEffect(lab, { activationZone: "fieldSpell" })?.id, ignition.id);
    assert.equal(d.game.effectEngine.getHandActivationEffect(lab), null);
    // A second effectless activation in the same turn is not limited either.
    const first = new Card(cardDefinition(309), d.owner.id), second = new Card(cardDefinition(309), d.owner.id);
    assert.equal((await activateFromHand(d, first)).success, true);
    assert.equal((await activateFromHand(d, second)).success, true);
    assertCardActivationLink(d, first);
    assertCardActivationLink(d, second);
    assert.equal(d.game.cardActivationHistory?.entries.length, 3);
  });

  for (const id of [17, 417]) {
    test(`Continuous Trap ${id} without an activation effect forms a link in open state (${seat})`, async t => {
      const d = duel(seat);
      t.after(() => d.game.dispose());
      const trap = new Card(cardDefinition(id), d.owner.id);
      const result = await activateFromSet(d, trap);
      assert.equal(result.success, true, result.reason ?? undefined);
      assert.equal(result.placementOnly, true);
      assertCardActivationLink(d, trap);
      assert.equal(trap.isFacedown, false);
      assert.ok(d.owner.spellTrap.includes(trap));
      assert.equal(d.owner.graveyard.includes(trap), false);
    });
  }

  test(`Fire Extreme Dragon reacts to the opponent's Field activation (${seat})`, async t => {
    const d = duel(seat);
    t.after(() => d.game.dispose());
    placeFieldCards(d.opponent.field, new Card(cardDefinition(270), d.opponent.id));
    const library = new Card(cardDefinition(312), d.owner.id);
    assert.equal((await activateFromHand(d, library)).success, true);
    const link = assertCardActivationLink(d, library);
    const burn = required(d.effectActivations.find(entry => entry.card?.id === 270));
    assert.equal(burn.chainId, link.chainId);
    assert.equal(burn.chainLevel, 2);
    assert.equal(d.owner.lp, 7700);
  });
}

/** The opponent is human: responses go through the chain_response decision and its modal. */
function respondAsHuman(d: Duel, chosenCardId: number | null) {
  d.opponent.controllerType = "human";
  const offers: { contextType: string | null; cards: (number | string | null)[]; history: (number | string | null)[][] }[] = [];
  const decisions: string[] = [];
  d.game.on("decision_made", decision => { if (decision.actorId === d.opponent.id) decisions.push(decision.kind); });
  d.game.ui.showChainResponseModal = async (candidates, context) => {
    offers.push({
      contextType: context?.type ?? null,
      cards: candidates.map(candidate => candidate.card?.id ?? null),
      history: (d.game.cardActivationHistory?.entries ?? []).map(entry => [entry.card.id, entry.chainId, entry.linkId]),
    });
    return candidates.find(candidate => chosenCardId !== null && candidate.card?.id === chosenCardId) ?? null;
  };
  return { offers, decisions };
}

for (const seat of SEATS) {
  test(`a human opponent receives the card_activation response decision and may pass (${seat})`, async t => {
    const d = duel(seat);
    t.after(() => d.game.dispose());
    const bahamut = new Card(cardDefinition(275), d.opponent.id);
    placeFieldCards(d.opponent.field, bahamut);
    const human = respondAsHuman(d, null);
    const library = new Card(cardDefinition(312), d.owner.id);
    assert.equal((await activateFromHand(d, library)).success, true);
    const link = assertCardActivationLink(d, library);
    assert.deepEqual(human.offers, [{ contextType: CHAIN_RESPONSE_CONTEXTS.CARD_ACTIVATION, cards: [275],
      history: [[312, link.chainId, link.linkId]] }]);
    assert.deepEqual(human.decisions, ["chain_response"]);
    assert.equal(d.owner.fieldSpell, library);
  });

  test(`Supreme Bahamut negates the effectless Field activation (${seat})`, async t => {
    const d = duel(seat);
    t.after(() => d.game.dispose());
    const bahamut = new Card(cardDefinition(275), d.opponent.id);
    placeFieldCards(d.opponent.field, bahamut);
    const human = respondAsHuman(d, 275);
    const library = new Card(cardDefinition(312), d.owner.id);
    const result = await activateFromHand(d, library);
    assert.equal(result.success, false);
    assert.equal(result.code, "ACTIVATION_NEGATED");
    const link = required(d.cardActivations.find(payload => payload.card === library));
    assert.ok(link.chainId != null && link.linkId != null);
    assert.equal(link.responseContextType, CHAIN_RESPONSE_CONTEXTS.CARD_ACTIVATION);
    assert.deepEqual(human.offers, [{ contextType: CHAIN_RESPONSE_CONTEXTS.CARD_ACTIVATION, cards: [275],
      history: [[312, link.chainId, link.linkId]] }], "the activation is in the history while the response is open");
    assert.deepEqual(human.decisions, ["chain_response"]);
    assert.equal(d.owner.fieldSpell, null);
    assert.ok(d.owner.graveyard.includes(library), "the negated Field Spell goes to the GY");
    assert.deepEqual(d.game.cardActivationHistory?.entries.filter(entry => entry.card.id === 312) ?? [], [],
      "negating the activation removes its history entry");
  });
}

for (const seat of SEATS) {
  test(`without a Chain the effectless activation stays a plain placement (${seat})`, async t => {
    const d = duel(seat, { disableChains: true });
    t.after(() => d.game.dispose());
    const library = new Card(cardDefinition(312), d.owner.id);
    const fromHand = await activateFromHand(d, library);
    assert.equal(fromHand.success, true, fromHand.reason ?? undefined);
    assert.equal(fromHand.placementOnly, true);
    assert.equal(d.owner.fieldSpell, library);
    const meeting = new Card(cardDefinition(309), d.owner.id);
    const fromSet = await activateFromSet(d, meeting);
    assert.equal(fromSet.success, true, fromSet.reason ?? undefined);
    assert.equal(fromSet.placementOnly, true);
    assert.equal(meeting.isFacedown, false, "the Set Spell is flipped face-up");
    assert.ok(d.owner.spellTrap.includes(meeting));
    assert.deepEqual([d.cardActivations.length, d.effectActivations.length, d.priority.length], [0, 0, 0]);
    assert.deepEqual(d.game.cardActivationHistory?.entries ?? [], []);
  });
}
