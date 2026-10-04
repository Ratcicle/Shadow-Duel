import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { EffectDefinition } from "../src/core/contracts/effects.js";
import type { CardAction } from "../src/core/contracts/actions.js";
import type { ReplayDecisionInput } from "../src/core/contracts/decisions.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "./helpers/game.js";

const migratedEffects = [
  [405, "bloomrot_carrioncap_battle_destroy_spore_counter", "bloomrot_carrioncap_battle_spore_target", 1],
  [407, "bloomrot_gravecap_widow_destroyed_infected_spore", "bloomrot_gravecap_widow_spore_target", 1],
  [408, "bloomrot_ancient_husk_ignition_spore_counters", "bloomrot_ancient_husk_spore_targets", 2],
  [408, "bloomrot_ancient_husk_destroyed_infected_spore", "bloomrot_ancient_husk_destroy_spore_targets", 2],
  [413, "bloomrot_fungal_armor_grave_spore_counter", "bloomrot_fungal_armor_spore_target", 1],
] as const;

for (const [id, effectId, selectionId, max] of migratedEffects) {
  test(`T01 ${effectId} declares a fresh resolution choice without activation targets`, () => {
    const effect = required(cardDefinition(id).effects?.find(candidate => candidate.id === effectId));
    assert.deepEqual(effect.targets || [], []);
    const choice = required(effect.actions?.find(action => action.type === "optional_target_actions"));
    assert.equal(choice.type, "optional_target_actions");
    if (choice.type !== "optional_target_actions") return;
    assert.equal(choice.optional, false); assert.equal(choice.allowCancel, false);
    const descriptor = required(choice.targets[0]);
    assert.equal(descriptor.id, selectionId); assert.equal(descriptor.intent, "reference");
    assert.equal(descriptor.targetFromContext, undefined);
    assert.deepEqual(descriptor.count, { min: 1, max });
  });
}

function setup(t: TestContext, seat: "player" | "bot", human = false) {
  const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
  if (human) owner.controllerType = "human";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
  game.ui.showChainResponseModal = async () => null;
  return { game, owner, opponent };
}

function choiceEffect(reference = true): EffectDefinition {
  const action: CardAction = { type: "optional_target_actions", optional: false, allowCancel: false,
    targets: [{ id: "resolution_spores", ...(reference ? { intent: "reference" as const } : {}), owner: "opponent", zone: "field",
      cardKind: "monster", requireFaceup: true, count: { min: 1, max: 2 } }],
    actions: [{ type: "add_counter", targetRef: "resolution_spores", counterType: "spore", amount: 1 }] };
  return Object.freeze({ id: "t01_resolution_fixture", timing: "ignition", activationZones: ["field"] as const, actions: [action] });
}

function monster(owner: string) { return new Card({ ...cardDefinition(1), effects: [] }, owner); }

async function finishChoices(game: RuntimeGame, pending: Promise<unknown>, inspect: (session: NonNullable<RuntimeGame["targetSelection"]>) => void) {
  let done = false; let failure: unknown;
  const completion = pending.then(() => { done = true; }, error => { failure = error; done = true; });
  const callbacks = new Set<Promise<void>>();
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session) {
      inspect(session);
      for (const requirement of session.requirements) {
        session.selections[requirement.id] = requirement.candidates.slice(0, requirement.max).map(candidate => candidate.key);
      }
      const callback = game.finishTargetSelection(); callbacks.add(callback);
      void callback.then(() => callbacks.delete(callback), error => { failure = error; callbacks.delete(callback); });
    }
    if (done && !game.targetSelection && callbacks.size === 0) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done, "the resolution choice must settle its real Chain/session");
  await completion;
  if (failure) throw failure;
  assert.equal(game.targetSelection, null);
}

for (const seat of ["player", "bot"] as const) {
  for (const planKind of ["missing", "duplicate", "empty", "overflow", "one", "two", "absent"] as const) {
    const invalid = planKind === "missing" || planKind === "duplicate" || planKind === "empty" || planKind === "overflow";
    test(`T01 ${invalid ? "invalid exact AI plan" : "valid AI plan"} ${planKind} uses the choice broker without substitution (${seat})`, async t => {
      const { game, owner, opponent } = setup(t, seat);
      const effect = required(cardDefinition(408).effects?.find(candidate => candidate.id === "bloomrot_ancient_husk_ignition_spore_counters"));
      const wrapper = required(effect.actions?.find(action => action.type === "optional_target_actions"));
      if (wrapper.type !== "optional_target_actions") assert.fail("real Husk effect must compose its resolution choice");
      const selectionId = required(wrapper.targets[0]).id;
      const source = new Card({ ...cardDefinition(408), effects: [effect] }, seat);
      const first = monster(opponent.id), second = monster(opponent.id), third = monster(opponent.id);
      placeFieldCards(owner.field, source); placeFieldCards(opponent.field, first, second, third);
      const ids = planKind === "missing" ? ["missing-instance"] : planKind === "duplicate" ? [first.instanceId, first.instanceId]
        : planKind === "empty" ? [] : planKind === "overflow" ? [first.instanceId, second.instanceId, third.instanceId]
        : planKind === "one" ? [second.instanceId] : [third.instanceId, first.instanceId];
      const activationContext = planKind === "absent" ? {} : { decisions: { selections: { [selectionId]: ids } } };
      const decisions: ReplayDecisionInput[] = []; let targeted = 0;
      game.on("decision_made", event => { decisions.push(event); }); game.on("effect_targeted", () => { targeted++; });
      const acceptedByAutoSelector: boolean[] = [];
      const selectBefore = game.autoSelector.select;
      game.autoSelector.select = (contract, context) => {
        const result = selectBefore.call(game.autoSelector, contract, context);
        acceptedByAutoSelector.push(result.ok);
        return result;
      };
      const result = await game.effectEngine.applyActions(effect.actions || [], { source, effect, player: owner, opponent, activationContext }, {});
      assert.deepEqual(acceptedByAutoSelector, [!invalid], "the real AutoSelector must accept or reject the exact plan before any fallback");
      assert.equal(decisions.length, 1); assert.equal(decisions[0]?.kind, "choice"); assert.equal(decisions[0]?.actorId, seat);
      assert.equal(targeted, 0); assert.equal(game.targetSelection, null);
      assert.equal(result.success, !invalid, "a rejected explicit plan must fail instead of choosing another legal card");
      const counters = [first, second, third].map(card => card.getCounter("spore"));
      if (invalid) {
        assert.deepEqual(counters, [0, 0, 0]);
        assert.deepEqual(decisions[0]?.value, { selections: {} }, "the broker records rejection without a substituted choice");
      } else if (planKind === "one") assert.deepEqual(counters, [0, 1, 0]);
      else if (planKind === "two") assert.deepEqual(counters, [1, 0, 1]);
      else assert.equal(counters.reduce((sum, counter) => sum + counter, 0), 1, "no plan uses the existing minimum policy");
    });
  }

  for (const protection of ["target", "effect"] as const) {
    test(`T01 local reference choice ignores targeting protection but preserves ${protection} immunity (${seat})`, async t => {
      const { game, owner, opponent } = setup(t, seat);
      const effect = choiceEffect(), source = new Card({ ...cardDefinition(408), effects: [effect] }, seat);
      const recipient = monster(opponent.id);
      if (protection === "target") Object.assign(recipient, { cannotBeTargeted: true });
      else recipient.unaffectedByOtherCardEffects = true;
      placeFieldCards(owner.field, source); placeFieldCards(opponent.field, recipient);
      const decisions: ReplayDecisionInput[] = []; let targeted = 0;
      game.on("decision_made", event => { decisions.push(event); });
      game.on("effect_targeted", () => { targeted++; });
      await game.effectEngine.applyActions(effect.actions || [], { source, effect, player: owner, opponent }, {});
      assert.equal(recipient.getCounter("spore"), protection === "target" ? 1 : 0);
      assert.equal(decisions.length, 1); assert.equal(decisions[0]?.kind, "choice");
      assert.equal(decisions[0]?.actorId, seat); assert.equal(targeted, 0);
      assert.deepEqual(effect.targets || [], [], "nested projection must not mutate the parent effect");
    });
  }

  test(`T01 existing local target descriptors keep targeting protection (${seat})`, async t => {
    const { game, owner, opponent } = setup(t, seat);
    const effect = choiceEffect(false), source = new Card({ ...cardDefinition(408), effects: [effect] }, seat);
    const recipient = Object.assign(monster(opponent.id), { cannotBeTargeted: true });
    placeFieldCards(owner.field, source); placeFieldCards(opponent.field, recipient);
    await game.effectEngine.applyActions(effect.actions || [], { source, effect, player: owner, opponent }, {});
    assert.equal(recipient.getCounter("spore"), 0);
  });

  test(`T01 mandatory choice reads current candidates after real Chain responses (${seat})`, async t => {
    const { game, owner, opponent } = setup(t, seat, true);
    const effect = choiceEffect(), source = new Card({ ...cardDefinition(408), effects: [effect] }, seat);
    const retired = monster(opponent.id), first = Object.assign(monster(opponent.id), { cannotBeTargeted: true }), second = monster(opponent.id);
    placeFieldCards(owner.field, source); placeFieldCards(opponent.field, retired); opponent.hand.push(first, second);
    game.autoSelector.select = () => assert.fail("human resolution choices must not invoke AutoSelector");
    const decisions: ReplayDecisionInput[] = []; let targeted = 0; let responded = false; let choices = 0;
    game.on("decision_made", event => { decisions.push(event); });
    game.on("effect_targeted", () => { targeted++; });
    game.chainSystem.offerChainResponses = async () => {
      if (!responded) {
        assert.equal(game.targetSelection, null); assert.equal(decisions.length, 0);
        assert.deepEqual(game.chainSystem.getLastChainLink()?.declaredTargets, []);
        responded = true;
        await game.moveCard(retired, opponent, "hand", { fromZone: "field", awaitCardMovedEvent: true });
        const firstMove = await game.moveCard(first, opponent, "field", { fromZone: "hand", summonOrigin: "effect_resolution", position: "attack", awaitCardMovedEvent: true });
        const secondMove = await game.moveCard(second, opponent, "field", { fromZone: "hand", summonOrigin: "effect_resolution", position: "attack", awaitCardMovedEvent: true });
        assert.ok(typeof firstMove === "boolean" ? firstMove : firstMove.success);
        assert.ok(typeof secondMove === "boolean" ? secondMove : secondMove.success);
      }
      return { offers: 0, activations: 0, lastActivator: null, chainBuilt: false, consecutivePasses: 2 };
    };
    const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: owner, effect,
      activationZone: "field", committed: true, costsPaid: true });
    await finishChoices(game, Promise.resolve(game.chainSystem.openActivationChain(prepared)), session => {
      choices++;
      assert.equal(game.chainSystem.isChainResolving(), true);
      assert.equal(session.kind, "choice"); assert.equal(session.owner, owner); assert.equal(session.allowCancel, false);
      const requirement = required(session.requirements[0]);
      assert.deepEqual([requirement.min, requirement.max], [1, 2]);
      assert.deepEqual(requirement.candidates.map(candidate => candidate.cardRef), [first, second]);
    });
    assert.equal(responded, true); assert.equal(choices, 1);
    assert.deepEqual([retired.getCounter("spore"), first.getCounter("spore"), second.getCounter("spore")], [0, 1, 1]);
    const resolutionChoices = decisions.filter(decision => decision.kind === "choice");
    assert.equal(targeted, 0); assert.equal(resolutionChoices.length, 1);
    assert.equal(resolutionChoices[0]?.actorId, seat);
    assert.equal(decisions.filter(decision => decision.kind === "target").length, 0);
  });

  for (const sourceZoneAtChoice of ["graveyard", "hand"] as const) {
  test(`T01 real Armor grave effect retains its historical source in ${sourceZoneAtChoice} for a resolution choice (${seat})`, async t => {
    const { game, owner, opponent } = setup(t, seat, true);
    const effect = required(cardDefinition(413).effects?.find(candidate => candidate.id === "bloomrot_fungal_armor_grave_spore_counter"));
    const armor = new Card({ ...cardDefinition(413), effects: [effect] }, seat);
    const recipient = Object.assign(monster(opponent.id), { cannotBeTargeted: true });
    placeFieldCards(owner.spellTrap, armor); placeFieldCards(opponent.field, recipient);
    const decisions: ReplayDecisionInput[] = []; let targeted = 0;
    game.on("decision_made", event => { decisions.push(event); }); game.on("effect_targeted", () => { targeted++; });
    game.autoSelector.select = () => assert.fail("human Armor choice must not invoke AutoSelector");
    if (sourceZoneAtChoice === "hand") {
      game.chainSystem.offerChainResponses = async () => {
        assert.ok(owner.graveyard.includes(armor));
        assert.equal(game.targetSelection, null);
        const moved = await game.moveCard(armor, owner, "hand", { fromZone: "graveyard", awaitCardMovedEvent: true });
        assert.ok(typeof moved === "boolean" ? moved : moved.success);
        return { offers: 0, activations: 0, lastActivator: null, chainBuilt: false, consecutivePasses: 2 };
      };
    }
    await finishChoices(game, Promise.resolve(game.moveCard(armor, owner, "graveyard", { fromZone: "spellTrap", awaitCardMovedEvent: true })), session => {
      assert.equal(session.kind, "choice"); assert.equal(session.card, armor);
      assert.ok(owner[sourceZoneAtChoice].includes(armor));
    });
    assert.equal(recipient.getCounter("spore"), 1); assert.equal(targeted, 0);
    assert.ok(owner[sourceZoneAtChoice].includes(armor)); assert.equal(decisions.at(-1)?.kind, "choice");
    assert.equal(decisions.at(-1)?.actorId, seat);
  });
  }
}
