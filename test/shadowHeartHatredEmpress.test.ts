import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import ChainSystem from "../src/core/ChainSystem.js";
import type { DecisionMadeEventPayload } from "../src/core/contracts/events.js";
import { cardDefinition, required, chainSelections } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, completeTestSelections } from "./helpers/game.js";

const SUMMON = "shadow_heart_hatred_empress_summon";
const NEGATE = "shadow_heart_hatred_empress_negate";
const EN = 'You can discard 2 "Shadow-Heart" monsters; Special Summon this card from your hand, then you can add 1 Level 8 "Shadow-Heart" monster from your Deck to your hand.\n\nYou can Tribute this card; negate the effects of all face-up monsters your opponent controls until the end of this turn, then all "Shadow-Heart" monsters you control gain 300 ATK for each monster whose effects were negated by this effect.\n\nYou can only use each effect of "Shadow-Heart Hatred Empress" once per turn.';
const PT = 'Você pode descartar 2 monstros "Coração Sombrio"; Invoque este card por Invocação-Especial da sua mão e, depois, você pode adicionar 1 monstro "Coração Sombrio" de Nível 8 do seu Deck à sua mão.\n\nVocê pode oferecer este card como Tributo; negue os efeitos de todos os monstros com a face para cima que seu oponente controla até o final deste turno e, depois, todos os monstros "Coração Sombrio" que você controla ganham 300 de ATK para cada monstro cujos efeitos foram negados por este efeito.\n\nVocê só pode usar cada efeito de "Imperatriz do Ódio do Coração Sombrio" uma vez por turno.';

function setup(t: TestContext, seat: "player" | "bot" = "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, randomSeed: 127, chainResponseTimeoutMs: 0,
    getFieldPlacementMode: () => "manual", fieldPlacementProvider: async () => ({ outcome: "chosen", slot: 4 }) });
  t.after(() => game.dispose());
  assert.ok(game.chainSystem instanceof ChainSystem, "integration coverage uses the real Chain");
  game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
  game.disablePresentationDelays = true;
  game.player.controllerType = game.bot.controllerType = "ai";
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.waitForBoardPresentation = async () => {};
  game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
  const owner = game[seat];
  const opponent = seat === "player" ? game.bot : game.player;
  const make = (id: number) => new Card(cardDefinition(id), owner.id);
  const source = make(127), first = make(101), second = make(125);
  owner.hand.push(source, first, second);
  return { game, owner, opponent, make, source, first, second };
}

type EmpressFixture = ReturnType<typeof setup>;

async function select(fixture: EmpressFixture, selectionId: string, cards: readonly Card[]) {
  const { game } = fixture;
  for (let attempt = 0; attempt < 1000 && !game.targetSelection; attempt++) {
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  const session = required(game.targetSelection, `missing selection ${selectionId}`);
  const requirement = required(session.requirements.find(requirement => requirement.id === selectionId));
  session.selections[selectionId] = cards.map(card => required(requirement.candidates.find(candidate => candidate.cardRef === card)).key);
  await game.finishTargetSelection();
}

async function negate(fixture: EmpressFixture) {
  const { game, owner, source } = fixture;
  owner.hand.splice(owner.hand.indexOf(source), 1);
  placeFieldCards(owner.field, source);
  const result = await game.tryActivateMonsterEffect(source, null, "field", owner, { effectId: NEGATE });
  assert.equal(result.success, true, result.reason || undefined);
}

test("Hatred Empress is the approved Main Deck monster with two independent effects", () => {
  const card = cardDefinition(127);
  assert.equal(card.name, "Shadow-Heart Hatred Empress");
  assert.equal(card.cardKind, "monster");
  assert.equal(card.level, 8);
  assert.equal(card.atk, 2800);
  assert.equal(card.def, 1800);
  assert.equal(card.type, "Warrior");
  assert.equal(card.attribute, "Dark");
  assert.equal(card.archetype, "Shadow-Heart");
  assert.equal(card.image, "assets/Shadow-Heart Hatred Empress.jpg");
  assert.equal(card.effects?.length, 2);
  assert.equal(card.effects?.every(effect => effect.oncePerTurn && effect.usagePolicy === "use" && !effect.oncePerTurnScope), true);
  assert.equal(new Set(card.effects?.map(effect => effect.oncePerTurnName)).size, 2);
});

test("approved EN/PT wording and catalog remain literal", () => {
  assert.equal(cardDefinition(127).description, EN);
  const locale: unknown = JSON.parse(readFileSync(new URL("../public/locales/pt-br.json", import.meta.url), "utf8"));
  assert.ok(locale && typeof locale === "object");
  const cards: unknown = Reflect.get(locale, "cards");
  assert.ok(cards && typeof cards === "object");
  const translated: unknown = Reflect.get(cards, "127");
  assert.ok(translated && typeof translated === "object");
  assert.equal(Reflect.get(translated, "name"), "Imperatriz do Ódio do Coração Sombrio");
  assert.equal(Reflect.get(translated, "description"), PT);
  const catalog = readFileSync(new URL("../docs/Archetypes/Shadow-Heart Archetype.md", import.meta.url), "utf8");
  for (const paragraph of PT.split("\n\n")) assert.ok(catalog.includes(`> ${paragraph}`));
  assert.ok(catalog.includes("27 cartas: 23 no Main Deck e 4 no Extra Deck"));
  assert.ok(catalog.includes("13 monstros, 9 Magias e 1 Armadilha"));
});

for (const seat of ["player", "bot"] as const) {
  for (const search of ["accept", "decline", "no candidate"] as const) {
    test(`human ${seat} pays exactly two before responses, chooses position and ${search} search`, { timeout: 10000 }, async t => {
      const fixture = setup(t, seat);
      const { game, owner, make, source, first, second } = fixture;
      owner.controllerType = "human";
      const recruit = make(104), low = make(107), spell = make(103), unrelated = make(1);
      owner.deck.push(low, spell, unrelated);
      if (search !== "no candidate") owner.deck.push(recruit);
      const decisions: DecisionMadeEventPayload[] = [];
      const events: string[] = [];
      const discardEvents: { contextLabel: string | null | undefined }[] = [];
      let responseState: { costsPaid: boolean; sourceInHand: boolean; searchedEarly: boolean } | null = null;
      let targeted = 0;
      game.on("decision_made", event => { decisions.push(event); });
      game.on("card_to_grave", event => {
        if (event.card === first || event.card === second) {
          events.push(`discard:${event.card.id}`);
        }
      });
      game.on("card_moved", event => {
        if ((event.card === first || event.card === second) && event.fromZone === "hand" && event.toZone === "graveyard") {
          discardEvents.push({ contextLabel: event.contextLabel });
        }
      });
      game.on("effect_targeted", event => { if (event.target === first || event.target === second) targeted++; });
      game.on("effect_activated", event => {
        if (event.card !== source) return;
        events.push("responses");
        responseState = { costsPaid: owner.graveyard.includes(first) && owner.graveyard.includes(second),
          sourceInHand: owner.hand.includes(source), searchedEarly: owner.hand.includes(recruit) };
      });
      game.on("after_summon", event => { if (event.card === source) events.push("summon"); });
      const activation = game.tryActivateMonsterEffect(source, null, "hand", owner, { effectId: SUMMON });
      for (let attempt = 0; attempt < 1000 && !game.targetSelection; attempt++) await new Promise<void>(resolve => setTimeout(resolve, 1));
      const costRequirement = required(required(game.targetSelection).requirements[0]);
      assert.equal(costRequirement.id, "hatred_empress_discard");
      assert.equal(costRequirement.min, 2); assert.equal(costRequirement.max, 2);
      assert.equal(costRequirement.candidates.some(candidate => candidate.cardRef === source), false);
      assert.equal(owner.graveyard.length, 0);
      const costChoice = select(fixture, "hatred_empress_discard", [first, second]);
      if (search !== "no candidate") {
        for (let attempt = 0; attempt < 1000 && !game.targetSelection?.requirements.some(requirement => requirement.id === "hatred_empress_search"); attempt++) await new Promise<void>(resolve => setTimeout(resolve, 1));
        const requirement = required(required(game.targetSelection).requirements.find(requirement => requirement.id === "hatred_empress_search"));
        assert.deepEqual(requirement.candidates.map(candidate => candidate.cardRef), [recruit]);
        assert.equal(requirement.min, 0); assert.equal(requirement.max, 1);
        assert.ok(owner.field.includes(source));
        await select(fixture, "hatred_empress_search", search === "accept" ? [recruit] : []);
      }
      await costChoice;
      assert.equal((await activation).success, true);
      assert.equal(source.position, "defense");
      assert.equal(targeted, 0, "discard costs are never declared effect targets");
      assert.deepEqual(events, ["discard:101", "discard:125", "responses", "summon"]);
      assert.deepEqual(responseState, { costsPaid: true, sourceInHand: true, searchedEarly: false });
      assert.equal(discardEvents.length, 2);
      assert.ok(discardEvents.every(event => event.contextLabel === "discard"));
      assert.equal(owner.hand.includes(recruit), search === "accept");
      assert.ok(owner.deck.includes(low) && owner.deck.includes(spell) && owner.deck.includes(unrelated));
      assert.ok(decisions.some(decision => decision.kind === "choice" && "candidateKey" in decision.value && decision.value.candidateKey === "defense"));
      assert.equal(decisions.filter(decision => decision.kind === "cost").length, 1);
      assert.equal(decisions.filter(decision => decision.kind === "target").length, search === "no candidate" ? 0 : 1);
      assert.equal(game.chainSystem.checkActivationUsage(make(127), owner, required(source.effects[0])).ok, false);
      assert.equal(game.chainSystem.checkActivationUsage(make(127), owner, required(source.effects[1])).ok, true);
    });
  }

  for (const invalid of ["one cost", "three costs", "source as cost", "spell as cost", "full field", "opponent turn", "battle", "wrong zone"] as const) {
    test(`E1 ${seat} rejects ${invalid} without payment or OPT`, async t => {
      const { game, owner, opponent, make, source, first, second } = setup(t, seat);
      const extra = make(invalid === "spell as cost" ? 103 : 101);
      owner.hand.push(extra);
      if (invalid === "full field") placeFieldCards(owner.field, ...Array.from({ length: 5 }, () => make(101)));
      if (invalid === "opponent turn") game.turn = opponent.id;
      if (invalid === "battle") game.phase = "battle";
      const chosen = invalid === "one cost" ? [first] : invalid === "three costs" ? [first, second, extra]
        : invalid === "source as cost" ? [source, first] : invalid === "spell as cost" ? [first, extra] : [first, second];
      const result = await game.tryActivateMonsterEffect(source, { hatred_empress_discard: chosen }, invalid === "wrong zone" ? "graveyard" : "hand", owner, { effectId: SUMMON });
      assert.equal(result.success, false);
      assert.equal(owner.graveyard.length, 0);
      assert.ok(owner.hand.includes(source) && owner.hand.includes(first) && owner.hand.includes(second));
      assert.equal(game.chainSystem.checkActivationUsage(source, owner, required(source.effects[0])).ok, true);
    });
  }

  for (const returns of [false, true]) {
    test(`E1 ${seat} source leaves hand (returns=${returns}) after payment: no summon or search`, async t => {
      const { game, owner, make, source, first, second } = setup(t, seat);
      const recruit = make(104); owner.deck.push(recruit);
      game.on("effect_activated", async event => {
        if (event.card !== source) return;
        await game.moveCard(source, owner, "graveyard", { fromZone: "hand" });
        if (returns) await game.moveCard(source, owner, "hand", { fromZone: "graveyard" });
      });
      await game.tryActivateMonsterEffect(source, { hatred_empress_discard: [first, second] }, "hand", owner, { effectId: SUMMON });
      assert.ok(owner.graveyard.includes(first) && owner.graveyard.includes(second));
      assert.equal(owner.field.includes(source), false);
      assert.ok(owner.deck.includes(recruit));
      assert.equal(owner.hand.includes(recruit), false);
      assert.equal(game.chainSystem.checkActivationUsage(make(127), owner, required(source.effects[0])).ok, false);
    });
  }

  test(`E1 ${seat} late field filling stops the dependent search`, async t => {
    const { game, owner, make, source, first, second } = setup(t, seat);
    const recruit = make(104); owner.deck.push(recruit);
    game.on("effect_activated", event => {
      if (event.card === source) placeFieldCards(owner.field, ...Array.from({ length: 5 }, () => make(101)));
    });
    await game.tryActivateMonsterEffect(source, { hatred_empress_discard: [first, second] }, "hand", owner, { effectId: SUMMON });
    assert.ok(owner.graveyard.includes(first) && owner.graveyard.includes(second));
    assert.ok(owner.hand.includes(source));
    assert.ok(owner.deck.includes(recruit));
  });

  test(`E2 ${seat} tribute precedes responses and counts only newly negated face-up monsters`, async t => {
    const fixture = setup(t, seat);
    const { game, owner, opponent, make, source, first } = fixture;
    owner.hand.splice(owner.hand.indexOf(first), 1);
    const ally = first, other = make(1), hiddenAlly = make(125); hiddenAlly.isFacedown = true;
    placeFieldCards(owner.field, ally, other, hiddenAlly);
    const fresh = new Card(cardDefinition(1), opponent.id), already = new Card(cardDefinition(1), opponent.id), immune = new Card(cardDefinition(1), opponent.id), hidden = new Card(cardDefinition(1), opponent.id);
    already.effectsNegated = true; immune.unaffectedByOpponentCardEffects = true; hidden.isFacedown = true;
    placeFieldCards(opponent.field, fresh, already, immune, hidden);
    let paid = false;
    game.on("effect_activated", event => { if (event.card === source) paid = owner.graveyard.includes(source); });
    await negate(fixture);
    assert.ok(paid);
    assert.equal(fresh.effectsNegated, true);
    assert.equal(already.effectsNegated, true);
    assert.equal(immune.effectsNegated, false);
    assert.equal(hidden.effectsNegated, false);
    assert.equal(ally.atk, ally.baseAtk + 300);
    assert.equal(other.atk, other.baseAtk);
    assert.equal(hiddenAlly.atk, hiddenAlly.baseAtk);
    assert.equal(source.atk, source.baseAtk);
    const newcomer = make(125);
    owner.hand.push(newcomer);
    await game.moveCard(newcomer, owner, "field", { fromZone: "hand", position: "attack", summonMethodOverride: "special", summonOrigin: "effect_resolution" });
    assert.ok(owner.field.includes(newcomer));
    assert.equal(newcomer.atk, newcomer.baseAtk, "resolved boosts do not apply to later recruits");
    game.cleanupTempBoosts(owner); game.cleanupTempBoosts(opponent);
    assert.equal(fresh.effectsNegated, false);
    assert.equal(ally.atk, ally.baseAtk + 300, "face-up boost persists across the end of the turn");
  });

  for (const opposition of ["none", "facedown", "already negated", "immune"] as const) {
    test(`E2 ${seat} activation gate checks opponent face-up presence (${opposition})`, async t => {
      const fixture = setup(t, seat);
      const { game, owner, opponent, source } = fixture;
      if (opposition !== "none") {
        const target = new Card(cardDefinition(1), opponent.id);
        target.isFacedown = opposition === "facedown";
        target.effectsNegated = opposition === "already negated";
        target.unaffectedByOpponentCardEffects = opposition === "immune";
        placeFieldCards(opponent.field, target);
      }
      owner.hand.splice(owner.hand.indexOf(source), 1); placeFieldCards(owner.field, source);
      const result = await game.tryActivateMonsterEffect(source, null, "field", owner, { effectId: NEGATE });
      const legal = opposition === "already negated" || opposition === "immune";
      assert.equal(result.success, legal, result.reason || undefined);
      assert.equal(owner.graveyard.includes(source), legal);
      assert.equal(game.chainSystem.checkActivationUsage(source, owner, required(source.effects[1])).ok, !legal);
    });
  }
  for (const invalid of ["source facedown", "opponent turn", "battle"] as const) {
    test(`E2 ${seat} rejects ${invalid} without tribute or OPT`, async t => {
      const { game, owner, opponent, source } = setup(t, seat);
      owner.hand.splice(owner.hand.indexOf(source), 1); placeFieldCards(owner.field, source);
      placeFieldCards(opponent.field, new Card(cardDefinition(1), opponent.id));
      if (invalid === "source facedown") source.isFacedown = true;
      if (invalid === "opponent turn") game.turn = opponent.id;
      if (invalid === "battle") game.phase = "battle";
      assert.equal((await game.tryActivateMonsterEffect(source, null, "field", owner, { effectId: NEGATE })).success, false);
      assert.ok(owner.field.includes(source));
      assert.equal(owner.graveyard.length, 0);
      assert.equal(game.chainSystem.checkActivationUsage(source, owner, required(source.effects[1])).ok, true);
    });
  }
}

test("discarding Coward pays the cost before responses and queues its real trigger behind Empress", async t => {
  const { game, owner, opponent, make, source, first, second } = setup(t);
  owner.hand.splice(owner.hand.indexOf(second), 1);
  const coward = make(109); owner.hand.push(coward);
  const target = new Card(cardDefinition(1), opponent.id); placeFieldCards(opponent.field, target);
  const resolutions: string[] = [];
  const discardOrder: number[] = [];
  let paidBeforeResponses = false;
  game.on("card_to_grave", event => { if (event.card === first || event.card === coward) discardOrder.push(required(event.card.id)); });
  game.on("effect_activated", event => { if (event.card === source) paidBeforeResponses = owner.graveyard.includes(first) && owner.graveyard.includes(coward); });
  game.on("chain_link_resolution", event => { if (event.stage === "completed" && event.effectId) resolutions.push(event.effectId); });
  assert.equal((await game.tryActivateMonsterEffect(source, { hatred_empress_discard: [first, coward] }, "hand", owner, { effectId: SUMMON })).success, true);
  assert.ok(paidBeforeResponses);
  assert.deepEqual(discardOrder, [101, 109]);
  assert.ok(owner.field.includes(source));
  assert.equal(target.atk, Math.floor(target.baseAtk / 2));
  assert.equal(target.def, Math.floor(target.baseDef / 2));
  assert.deepEqual(resolutions, [SUMMON, "shadow_heart_coward_discard"]);
});

test("human cancellation of discard selection commits neither cost nor hard OPT", { timeout: 10000 }, async t => {
  const { game, owner, source, first, second } = setup(t);
  owner.controllerType = "human";
  const activation = game.tryActivateMonsterEffect(source, null, "hand", owner, { effectId: SUMMON });
  for (let attempt = 0; attempt < 1000 && !game.targetSelection; attempt++) await new Promise<void>(resolve => setTimeout(resolve, 1));
  assert.ok(game.targetSelection);
  game.cancelTargetSelection();
  assert.equal((await activation).success, false);
  assert.ok(owner.hand.includes(source) && owner.hand.includes(first) && owner.hand.includes(second));
  assert.equal(owner.graveyard.length, 0);
  assert.equal(game.chainSystem.checkActivationUsage(source, owner, required(source.effects[0])).ok, true);
});

test("negated real Chain activations retain costs and consume the two hard OPTs independently across copies", async t => {
  const { game, owner, opponent, make, source, first, second } = setup(t);
  const copy = make(127), target = new Card(cardDefinition(1), opponent.id);
  owner.hand.push(copy); placeFieldCards(opponent.field, target);
  const summon = required(source.effects[0]), negation = required(source.effects[1]);
  const preparedSummon = game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect: summon,
    activationZone: "hand", committed: true, activationNegated: true, costSelections: chainSelections({ hatred_empress_discard: [first, second] }) });
  assert.equal((await game.chainSystem.payActivationCosts(preparedSummon)).success, true);
  required(game.chainSystem.addToChain(preparedSummon));
  await game.chainSystem.resolveChain();
  assert.ok(owner.graveyard.includes(first) && owner.graveyard.includes(second));
  assert.ok(owner.hand.includes(source));
  assert.equal(game.chainSystem.checkActivationUsage(copy, owner, summon).ok, false);
  assert.equal(game.chainSystem.checkActivationUsage(copy, owner, negation).ok, true);
  owner.hand.splice(owner.hand.indexOf(source), 1); placeFieldCards(owner.field, source);
  const preparedNegation = game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect: negation,
    activationZone: "field", committed: true, activationNegated: true });
  assert.equal((await game.chainSystem.payActivationCosts(preparedNegation)).success, true);
  required(game.chainSystem.addToChain(preparedNegation));
  await game.chainSystem.resolveChain();
  assert.ok(owner.graveyard.includes(source));
  assert.equal(target.effectsNegated, false);
  assert.equal(game.chainSystem.checkActivationUsage(copy, owner, negation).ok, false);
});

for (const lifecycle of ["face down", "leave and return", "control transfer"] as const) {
  test(`E2 granted ATK lifecycle: ${lifecycle}`, async t => {
    const fixture = setup(t);
    const { game, owner, opponent, source, first } = fixture;
    owner.hand.splice(owner.hand.indexOf(first), 1); placeFieldCards(owner.field, first);
    placeFieldCards(opponent.field, new Card(cardDefinition(1), opponent.id));
    await negate(fixture);
    assert.equal(first.atk, first.baseAtk + 300);
    if (lifecycle === "face down") {
      await game.effectEngine.applyActions([{ type: "set_facedown_defense", targetRef: "ally" }], { source, player: owner, opponent }, { ally: [first] });
      assert.equal(first.atk, first.baseAtk);
      first.isFacedown = false;
      await game.emit("position_change", { card: first, player: owner });
      assert.equal(first.atk, first.baseAtk);
    } else if (lifecycle === "leave and return") {
      await game.moveCard(first, owner, "graveyard", { fromZone: "field" });
      assert.equal(first.atk, first.baseAtk);
      await game.moveCard(first, owner, "field", { fromZone: "graveyard", position: "attack", summonMethodOverride: "special", summonOrigin: "effect_resolution" });
      assert.ok(owner.field.includes(first));
      assert.equal(first.atk, first.baseAtk);
    } else {
      const version = first.locationVersion;
      assert.equal((await game.transferControl(first, opponent)).success, true);
      assert.equal(first.locationVersion, version);
      assert.equal(first.atk, first.baseAtk + 300);
      game.cleanupTempBoosts(opponent);
      assert.equal(first.atk, first.baseAtk + 300);
    }
  });
}

test("E2 real human CL2 changes both fields before negation and the resolved boost", { timeout: 15000 }, async t => {
  const fixture = setup(t);
  const { game, owner, opponent, make, source, first } = fixture;
  owner.controllerType = opponent.controllerType = "human";
  owner.hand.splice(owner.hand.indexOf(first), 1);
  const survivor = first, leavingAlly = make(125), enteringAlly = make(125);
  leavingAlly.name = "Leaving ally"; enteringAlly.name = "Entering ally";
  placeFieldCards(owner.field, survivor, leavingAlly); owner.hand.push(enteringAlly);
  const leavingOpponent = new Card({ ...cardDefinition(1), name: "Leaving opponent" }, opponent.id);
  const remainingOpponent = new Card({ ...cardDefinition(1), name: "Remaining opponent" }, opponent.id);
  const enteringOpponent = new Card({ ...cardDefinition(1), name: "Entering opponent" }, opponent.id);
  placeFieldCards(opponent.field, leavingOpponent, remainingOpponent); opponent.hand.push(enteringOpponent);
  const response = new Card({ name: "Scope change response fixture", cardKind: "spell", subtype: "continuous", effects: [{
    id: "empress_scope_change_response", timing: "ignition", speed: 2, isQuickEffect: true,
    activationZones: ["spellTrap"], requireFaceup: true,
    actions: [
      { type: "move", player: "self", to: "graveyard", fromZone: "field", targetScope: { owner: "self", zones: ["field"], filters: { name: "Leaving opponent" } } },
      { type: "special_summon_from_zone", player: "self", zone: "hand", filters: { name: "Entering opponent" }, position: "attack", promptPlayer: true },
      { type: "move", player: "opponent", to: "hand", fromZone: "field", targetScope: { owner: "opponent", zones: ["field"], filters: { name: "Leaving ally" } } },
      { type: "special_summon_from_zone", sourceOwner: "opponent", summonToOwner: "opponent", zone: "hand", filters: { name: "Entering ally" }, position: "attack", promptPlayer: true },
    ],
  }] }, opponent.id);
  placeFieldCards(opponent.spellTrap, response);
  let offered = false;
  game.ui.showChainResponseModal = async candidates => {
    if (offered) return null;
    const choice = candidates.find(candidate => candidate.card === response);
    if (choice) offered = true;
    return choice ?? null;
  };
  const resolutions: string[] = [];
  const decisions: DecisionMadeEventPayload[] = [];
  game.on("chain_link_resolution", event => { if (event.stage === "completed" && event.effectId) resolutions.push(event.effectId); });
  game.on("decision_made", event => { decisions.push(event); });
  owner.hand.splice(owner.hand.indexOf(source), 1); placeFieldCards(owner.field, source);
  const activation = game.tryActivateMonsterEffect(source, null, "field", owner, { effectId: NEGATE });
  await completeTestSelections(game, activation);
  assert.equal((await activation).success, true);
  assert.ok(offered);
  assert.deepEqual(resolutions, ["empress_scope_change_response", NEGATE]);
  assert.ok(opponent.graveyard.includes(leavingOpponent));
  assert.equal(leavingOpponent.effectsNegated, false);
  assert.ok(opponent.field.includes(enteringOpponent));
  assert.equal(remainingOpponent.effectsNegated, true); assert.equal(enteringOpponent.effectsNegated, true);
  assert.ok(owner.hand.includes(leavingAlly)); assert.equal(leavingAlly.atk, leavingAlly.baseAtk);
  assert.ok(owner.field.includes(enteringAlly));
  assert.equal(survivor.atk, survivor.baseAtk + 600); assert.equal(enteringAlly.atk, enteringAlly.baseAtk + 600);
  assert.ok(decisions.some(decision => decision.kind === "chain_response" && Reflect.get(decision.value, "pass") === false));
});

test("E2 boost outlives source revival and a later source exit; a new turn resets both hard OPTs", async t => {
  const fixture = setup(t);
  const { game, owner, opponent, make, source, first, second } = fixture;
  placeFieldCards(opponent.field, new Card(cardDefinition(1), opponent.id));
  assert.equal((await game.tryActivateMonsterEffect(source, { hatred_empress_discard: [first, second] }, "hand", owner, { effectId: SUMMON })).success, true);
  const ally = make(101); owner.hand.push(ally);
  await game.moveCard(ally, owner, "field", { fromZone: "hand", position: "attack", summonMethodOverride: "special", summonOrigin: "effect_resolution" });
  const tribute = await game.tryActivateMonsterEffect(source, null, "field", owner, { effectId: NEGATE });
  assert.equal(tribute.success, true);
  assert.equal(ally.atk, ally.baseAtk + 300);
  await game.moveCard(source, owner, "field", { fromZone: "graveyard", position: "attack", summonMethodOverride: "special", summonOrigin: "effect_resolution" });
  assert.ok(owner.field.includes(source));
  assert.equal(ally.atk, ally.baseAtk + 300);
  await game.moveCard(source, owner, "graveyard", { fromZone: "field" });
  assert.equal(ally.atk, ally.baseAtk + 300);
  const copy = make(127);
  for (const effect of source.effects) assert.equal(game.chainSystem.checkActivationUsage(copy, owner, effect).ok, false);
  for (const player of [owner, opponent]) player.deck.push(...Array.from({ length: 6 }, () => new Card(cardDefinition(1), player.id)));
  game.turn = opponent.id;
  await game.startTurn();
  assert.equal(ally.atk, ally.baseAtk + 300);
  game.turn = owner.id;
  await game.startTurn();
  game.phase = "main1";
  for (const effect of source.effects) assert.equal(game.chainSystem.checkActivationUsage(copy, owner, effect).ok, true);
});
