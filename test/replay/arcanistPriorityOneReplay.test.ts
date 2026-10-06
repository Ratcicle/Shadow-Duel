import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { PlayerId } from "../../src/core/contracts/primitives.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { record, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Scenario = "meeting_monsters" | "meeting_spells" | "library_summon" | "library_search" | "ink" | "tornado";
type Controller = "human" | "ai";

const cases = {
  meeting_monsters: "meeting_arcanists_discard_monsters",
  meeting_spells: "meeting_arcanists_discard_spells",
  library_summon: "arcanist_grand_library_summon",
  library_search: "arcanist_grand_library_search_equip",
} as const;

function installFixture(game: RuntimeGame, seat: PlayerId, controller: Controller, scenario: Scenario, withSecondCopy: boolean) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat;
    game.phase = "main1";
    game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    const owner = game[seat];
    owner.controllerType = controller;
    owner.deck = [...owner.hand, ...owner.deck];
    owner.hand = [];
    const take = (id: number) => {
      const card = required(owner.deck.find(candidate => candidate.id === id));
      owner.deck.splice(owner.deck.indexOf(card), 1);
      return card;
    };
    if (scenario.startsWith("meeting")) {
      placeFieldCards(owner.spellTrap, take(309));
      if (withSecondCopy) placeFieldCards(owner.spellTrap, take(309));
      owner.hand.push(take(306), take(307), take(304), take(310));
    } else if (scenario.startsWith("library")) {
      owner.fieldSpell = take(312);
      if (withSecondCopy) owner.hand.push(take(312));
      if (scenario === "library_search") placeFieldCards(owner.field, take(306));
    } else if (scenario === "ink") {
      const river = take(311);
      river.addCounter("ink", 3);
      placeFieldCards(owner.spellTrap, river);
      owner.graveyard.push(take(304), take(310));
    } else {
      owner.hand.push(take(315));
      const bearer = take(306), equip = take(301);
      placeFieldCards(owner.field, bearer);
      placeFieldCards(owner.spellTrap, equip);
      equip.equippedTo = bearer;
      bearer.equips = [equip];
      const opponent = game.getOpponent(owner);
      const target = required([...opponent.hand, ...opponent.deck].find(card => card.id === 303));
      opponent.hand = opponent.hand.filter(card => card !== target);
      opponent.deck = opponent.deck.filter(card => card !== target);
      placeFieldCards(opponent.spellTrap, target);
    }
  };
  if (scenario === "tornado") {
    game.on("effect_activated", async event => {
      if (event.card.id !== 315) return;
      const owner = game[seat];
      const equip = required(owner.spellTrap.find(card => card.id === 301));
      await game.moveCard(equip, owner, "graveyard", { fromZone: "spellTrap" });
    });
  }
}

async function finishSelections(
  game: RuntimeGame,
  action: Promise<unknown>,
  caseId: string | null,
  cancel: "choice" | "cost" | null = null,
) {
  let done = false, cancelled = false;
  let failure: unknown;
  const completion = action.then(() => { done = true; }, error => { done = true; failure = error; });
  const resolutions = new Set<Promise<void>>();
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session) {
      if (!cancelled && cancel === session.kind) {
        cancelled = true;
        game.cancelTargetSelection();
      } else {
        for (const requirement of session.requirements) {
          const selectedCase = caseId && requirement.candidates.find(candidate => candidate.cardRef?.id === caseId);
          session.selections[requirement.id] = selectedCase
            ? [selectedCase.key]
            : requirement.candidates.slice(0, requirement.min).map(candidate => candidate.key);
        }
        const resolution = game.finishTargetSelection();
        resolutions.add(resolution);
        void resolution.then(() => resolutions.delete(resolution), error => { failure = error; resolutions.delete(resolution); });
      }
    }
    if (done && !game.targetSelection && resolutions.size === 0) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done && !game.targetSelection && resolutions.size === 0, "all decisions and selection callbacks must finish");
  await completion;
  if (failure) throw failure;
  if (cancel) assert.equal(cancelled, true, `expected a cancellable ${cancel} decision`);
}

async function setup(t: TestContext, seat: PlayerId, controller: Controller, scenario: Scenario, withSecondCopy = false) {
  const live = createRuntimeGame({ captureReplay: true, randomSeed: 731, laboratoryMode: true,
    laboratoryUseBot: false, chainResponseTimeoutMs: 0, getFieldPlacementMode: () => "manual",
    fieldPlacementProvider: async () => ({ outcome: "chosen", slot: 4 }) });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
    laboratoryUseBot: false, chainResponseTimeoutMs: 0,
    getFieldPlacementMode: () => assert.fail("Playback must not consult placement preferences."),
    fieldPlacementProvider: async () => assert.fail("Playback must not request placement.") });
  t.after(() => { live.dispose(); playback.dispose(); });
  for (const game of [live, playback]) installFixture(game, seat, controller, scenario, withSecondCopy);
  live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
  live.ui.showChainResponseModal = async () => null;
  playback.ui.showConfirmPrompt = async () => assert.fail("Playback must not ask for confirmation.");
  playback.ui.showChainResponseModal = async () => assert.fail("Playback must not ask for a response.");
  playback.ui.showSpecialSummonPositionModal = () => assert.fail("Playback must not ask for position.");
  playback.ui.showTargetSelection = () => assert.fail("Playback must not ask for targets or an activation case.");
  playback.autoSelector.select = () => assert.fail("Playback must consume recorded choices without rerunning policy.");
  const extraCopies = withSecondCopy ? scenario.startsWith("meeting") ? [309] : [312, 301] : [];
  const deck = [309, 312, 311, 315, 306, 307, 304, 310, 301, 302, 303, 305, ...extraCopies, ...Array<number>(8).fill(3)];
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
    startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
    playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
  const owner = live[seat];
  const source = required(scenario.startsWith("library") ? owner.fieldSpell
    : scenario === "tornado" ? owner.hand[0] : owner.spellTrap[0]);
  const caseId = scenario in cases ? cases[scenario as keyof typeof cases] : null;
  if (controller === "ai" && caseId) {
    const select = live.autoSelector.select.bind(live.autoSelector);
    live.autoSelector.select = (contract, context) => select(contract, { ...required(context),
      activationContext: { ...context?.activationContext,
        decisions: { ...context?.activationContext?.decisions, cases: {
          [scenario.startsWith("meeting") ? "meeting_arcanists_choose_effect" : "arcanist_grand_library_ignition"]: caseId,
          ...context?.activationContext?.decisions?.cases,
        } } } });
  }
  const activate = () => scenario.startsWith("library") ? Promise.resolve(live.activateFieldSpellEffect(source))
    : scenario === "tornado" ? live.tryActivateSpell(source, 0, null, { owner })
    : live.tryActivateSpellTrapEffect(source, null, { owner });
  const replay = async (commandCount = 1) => {
    const saved = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "arcanist-p1" }))));
    assert.equal(saved.schemaVersion, 2);
    assert.equal(saved.engineVersion, "engine-rules-v23");
    assert.equal(saved.commands.length, commandCount);
    assert.equal(saved.commands[0]?.type, scenario === "tornado" ? "activate_card" : "activate_effect");
    const result = await replayCanonicalDuel(saved, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Both real Games install the same deterministic fixture before the canonical command runs.") });
    assert.equal(result.finalStateHash, saved.result?.finalStateHash);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.equal(playback.decisionBroker.replayCursor, saved.decisions.length);
    return saved;
  };
  return { live, playback, owner, source, caseId, activate, replay };
}

for (const seat of ["player", "bot"] as const) {
  for (const scenario of ["meeting_monsters", "library_search"] as const) {
    for (const controller of ["human", "ai"] as const) {
      test(`P2 per-copy ignition replay preserves two independent copies (${scenario}, ${seat}, ${controller})`, async t => {
        const { live, owner, source, caseId, activate, replay } = await setup(t, seat, controller, scenario, true);
        const second = required(scenario === "meeting_monsters"
          ? owner.spellTrap.find(card => card.id === 309 && card !== source)
          : owner.hand.find(card => card.id === 312));
        const firstAction = activate();
        await finishSelections(live, firstAction, caseId);
        assert.equal((await firstAction).success, true);
        const effect = required(source.effects.find(entry => entry.timing === "ignition"));
        assert.equal(live.canUseOncePerTurn(source, owner, effect).ok, false);
        assert.equal(live.canUseOncePerTurn(second, owner, effect).ok, true);
        if (scenario === "library_search") {
          const replacement = live.tryActivateSpell(second, owner.hand.indexOf(second), null, { owner });
          await finishSelections(live, replacement, null);
          assert.equal((await replacement).success, true);
          assert.ok(owner.graveyard.includes(source)); assert.equal(owner.fieldSpell, second);
        }
        const secondCase = scenario === "meeting_monsters" ? "meeting_arcanists_discard_spells" : caseId;
        const secondAction = scenario === "meeting_monsters"
          ? live.tryActivateSpellTrapEffect(second, null, { owner,
            activationContext: { decisions: { cases: { meeting_arcanists_choose_effect: required(secondCase) } } } })
          : Promise.resolve(live.activateFieldSpellEffect(second));
        await finishSelections(live, secondAction, secondCase);
        assert.equal((await secondAction).success, true);
        assert.equal(live.canUseOncePerTurn(second, owner, effect).ok, false);
        assert.equal(owner.hand.length, 2);
        if (scenario === "meeting_monsters") assert.equal(owner.graveyard.length, 4);
        else assert.equal(owner.lp, 8000);
        const saved = await replay(scenario === "meeting_monsters" ? 2 : 3);
        const activations = saved.commands.filter(command => command.type === "activate_effect");
        assert.deepEqual(activations.map(command => record(command.payload).duelCardId), [source.duelCardId, second.duelCardId]);
        assert.notEqual(source.duelCardId, second.duelCardId);
        const choices = saved.decisions.filter(decision => decision.kind === "choice");
        assert.equal(choices.length, 2);
        assert.ok(JSON.stringify(choices[0]?.value).includes(required(caseId)));
        assert.ok(JSON.stringify(choices[1]?.value).includes(required(secondCase)));
      });
    }
  }

  for (const controller of ["human", "ai"] as const) {
    for (const scenario of ["meeting_monsters", "meeting_spells", "library_summon", "library_search", "ink", "tornado"] as const) {
      test(`P1 replay preserves ${scenario}, declared costs and resolution (${seat}, ${controller})`, async t => {
        const { live, owner, source, caseId, activate, replay } = await setup(t, seat, controller, scenario);
        const order: string[] = [];
        let announced = false;
        const costsAtAnnouncement: { graveyard: number[]; lp: number; ink: number }[] = [];
        live.on("decision_made", event => { order.push(event.kind); });
        live.on("activation_transaction", event => { if (event.duelCardId === source.duelCardId) order.push(event.stage); });
        live.on("effect_activated", event => {
          if (event.card !== source) return;
          announced = true;
          costsAtAnnouncement.push({ graveyard: owner.graveyard.map(card => required(card.id)).sort(), lp: owner.lp, ink: source.getCounter("ink") });
          order.push("announced");
        });
        const action = activate();
        await finishSelections(live, action, caseId);
        assert.equal((await action).success, true, (await action).reason ?? undefined);
        assert.equal(announced, true);
        const paid = required(costsAtAnnouncement[0]);
        if (scenario.startsWith("meeting")) {
          assert.deepEqual(paid.graveyard, scenario === "meeting_monsters" ? [306, 307] : [304, 310], "discard must be paid before responses");
        } else if (scenario === "library_summon") assert.equal(paid.lp, 6000, "LP must be paid before responses");
        else if (scenario === "ink") assert.equal(paid.ink, 1, "Ink must be removed before responses");
        if (caseId) {
          assert.ok(order.indexOf("choice") >= 0, "the activation case must be a recorded choice");
          assert.ok(order.indexOf("choice") < order.indexOf("source_committed"), "case choice must precede commitment");
        }
        if (scenario.startsWith("meeting")) {
          assert.equal(owner.graveyard.length, 2, "the two discarded cards must be paid exactly once");
          assert.equal(owner.hand.length, 3);
        } else if (scenario === "library_summon") {
          assert.equal(owner.lp, 6000);
          assert.equal(owner.field.length, 1);
          const summoned = required(owner.field[0]);
          assert.equal(summoned.archetype, "Arcanist");
          assert.ok(summoned.level <= 4);
          if (controller === "human") {
            assert.equal(summoned.position, "defense");
            assert.equal(summoned.fieldSlot, 4);
          }
        } else if (scenario === "library_search") {
          assert.equal(owner.lp, 8000);
          assert.equal(owner.hand.length, 1);
          assert.equal(owner.hand[0]?.subtype, "equip");
        } else if (scenario === "ink") {
          assert.equal(source.getCounter("ink"), 1);
          assert.equal(owner.hand.length, 1);
          assert.equal(owner.graveyard.length, 1);
        } else {
          assert.ok(owner.graveyard.some(card => card.id === 301));
          assert.ok(live.getOpponent(owner).graveyard.some(card => card.id === 303), "removing the equip after activation cannot retroactively invalidate Tornado");
        }
        const saved = await replay();
        if (caseId) {
          const choice = required(saved.decisions.find(decision => decision.kind === "choice"));
          assert.equal(choice.actorId, seat);
          assert.ok(JSON.stringify(choice.value).includes(caseId), "the declared case ID must survive serialization");
        }
        if (scenario.startsWith("meeting")) assert.equal(saved.decisions.filter(decision => decision.kind === "cost").length, 1);
        if (scenario === "library_summon" && controller === "human") assert.ok(saved.decisions.some(decision => decision.kind === "field_placement"));
      });
    }
  }

  for (const scenario of ["meeting_monsters", "library_summon"] as const) {
    for (const cancel of scenario === "meeting_monsters" ? ["choice", "cost"] as const : ["choice"] as const) {
      test(`P1 replay preserves ${scenario} cancellation at ${cancel} without payment (${seat})`, async t => {
        const { live, owner, source, caseId, activate, replay } = await setup(t, seat, "human", scenario);
        const before = createCanonicalStateSnapshot(live);
        let announcements = 0;
        live.on("effect_activated", event => { if (event.card === source) announcements++; });
        const action = activate();
        await finishSelections(live, action, caseId, cancel);
        assert.equal(announcements, 0);
        assert.equal(owner.lp, 8000);
        assert.deepEqual(createCanonicalStateSnapshot(live).players, before.players);
        assert.deepEqual(createCanonicalStateSnapshot(live).usage, before.usage);
        const saved = await replay();
        assert.ok(saved.decisions.some(decision => decision.kind === cancel && decision.actorId === seat && record(decision.value).pass === true));
      });
    }
  }
}
