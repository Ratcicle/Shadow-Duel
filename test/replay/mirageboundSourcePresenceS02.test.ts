import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { PlayerId } from "../../src/core/contracts/primitives.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import type { SelectionRequirement } from "../../src/core/contracts/selection.js";
import { getLocale, setLocale } from "../../src/core/i18n.js";
import {
  createCanonicalStateSnapshot,
  hashCanonicalGameState,
  validateCanonicalReplay,
} from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, type RuntimeGame } from "../helpers/game.js";

type Controller = "human" | "ai";
type Scenario = "jackal" | "rebel";
const sourceIds = { jackal: 353, rebel: 364 } as const;
const effectIds = {
  jackal: "miragebound_jackal_hand_summon_on_return",
  rebel: "miragebound_rebel_hand_summon_on_position_change",
} as const;

function selectRequirement(requirement: SelectionRequirement, scenario: Scenario) {
  const preferredId = requirement.id === "natural_selection_cost" ? sourceIds[scenario]
    : requirement.id === "natural_selection_target" ? 354
    : requirement.id === "miragebound_dancer_bounce_target" ? 351
    : requirement.id === "miragebound_jackal_return_shift_target" ||
      requirement.id === "miragebound_scout_position_target" ? 1 : null;
  const preferred = preferredId === null ? undefined
    : requirement.candidates.find(candidate => candidate.cardRef?.id === preferredId);
  if (preferredId !== null) assert.ok(preferred, `${requirement.id} must offer its legal intended card`);
  return preferred ? [preferred.key]
    : requirement.candidates.slice(0, requirement.min).map(candidate => candidate.key);
}

async function finishChoices(game: RuntimeGame, action: Promise<unknown>, scenario: Scenario) {
  let done = false, failure: unknown;
  const completion = action.then(() => { done = true; }, error => { done = true; failure = error; });
  const callbacks = new Set<Promise<void>>();
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session) {
      for (const requirement of session.requirements) {
        session.selections[requirement.id] = selectRequirement(requirement, scenario);
      }
      const pending = game.finishTargetSelection(); callbacks.add(pending);
      void pending.then(() => callbacks.delete(pending), error => { callbacks.delete(pending); failure = error; });
    }
    if (done && !game.targetSelection && callbacks.size === 0) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done && !game.targetSelection && callbacks.size === 0, "all live decisions must finish");
  await completion;
  if (failure) throw failure;
}

/** Configure controllers and presentation only; setup and every zone change use real duel commands. */
function configureGame(game: RuntimeGame, seat: PlayerId, controller: Controller,
  scenario: Scenario, removeSource: boolean) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.phaseDelayMs = 0; game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    game[seat].controllerType = controller;
    for (const player of [game.player, game.bot]) player.strategy = {
      chooseSpecialSummonPosition: () => game.replayMode === "playback"
        ? assert.fail("Playback must consume recorded position without calling AI policy") : "defense",
      chooseChainResponse: ({ activatable }) => {
        if (game.replayMode === "playback") assert.fail("Playback must consume recorded Chain responses without AI policy");
        const sourceOnChain = game.chainSystem.getChainSummary().some(link => link.effectId === effectIds[scenario]);
        return activatable.find(candidate => removeSource && sourceOnChain && candidate.card.id === 21) ?? { pass: true };
      },
    };
  };
}

async function setup(t: TestContext, seat: PlayerId, controller: Controller,
  scenario: Scenario, removeSource: boolean, playbackController: Controller = controller) {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "info", () => {});
  const previousLocale = getLocale(); setLocale("en");
  const live = createRuntimeGame({ captureReplay: true, randomSeed: 438,
    laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0,
    getFieldPlacementMode: () => "automatic" });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback",
    laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0,
    getFieldPlacementMode: () => assert.fail("Playback must consume recorded placement preferences"),
    fieldPlacementProvider: async () => assert.fail("Playback must not request placement") });
  t.after(() => { live.dispose(); playback.dispose(); setLocale(previousLocale); });
  configureGame(live, seat, controller, scenario, removeSource);
  configureGame(playback, seat, playbackController, scenario, removeSource);
  live.ui.showConfirmPrompt = async () => true;
  live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
  live.ui.showTriggerOrderModal = async (options = {}) => (options.candidates ?? []).map(candidate => candidate.candidateId);
  live.ui.showChainResponseModal = async candidates => {
    const sourceOnChain = live.chainSystem.getChainSummary().some(link => link.effectId === effectIds[scenario]);
    return candidates.find(candidate => removeSource && sourceOnChain && candidate.card?.id === 21) ?? null;
  };
  playback.ui.showConfirmPrompt = async () => assert.fail("Playback must not ask for confirmation");
  playback.ui.showSpecialSummonPositionModal = () => assert.fail("Playback must not ask for summon position");
  playback.ui.showChainResponseModal = async () => assert.fail("Playback must not ask for Chain responses");
  playback.ui.showTriggerOrderModal = async () => assert.fail("Playback must not ask for trigger ordering");
  playback.ui.showTargetSelection = () => assert.fail("Playback must not ask for targets or costs");
  playback.autoSelector.select = () => assert.fail("Playback must not recompute AI selections");
  playback.autoSelector.orderTriggerCandidates = () => assert.fail("Playback must not recompute AI trigger ordering");
  const select = live.autoSelector.select.bind(live.autoSelector);
  live.autoSelector.select = (contract, context) => {
    const normalized = live.normalizeSelectionContract(contract);
    if (!normalized.ok) return select(contract, context);
    return { ok: true, selections: Object.fromEntries(normalized.contract.requirements.map(requirement =>
      [requirement.id, selectRequirement(requirement, scenario)])) };
  };
  const ownerDeck = scenario === "jackal" ? [351, 352, 353, 21, ...Array<number>(16).fill(3)]
    : [351, 364, 21, ...Array<number>(17).fill(3)];
  const opponentDeck = [1, 354, ...Array<number>(18).fill(3)];
  const startingPlayer = seat === "player" ? "bot" : "player";
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
    startAtDrawPhase: true, startingPlayer, announceStartingPlayer: false,
    playerDeck: [...(seat === "player" ? ownerDeck : opponentDeck)].reverse(),
    botDeck: [...(seat === "bot" ? ownerDeck : opponentDeck)].reverse(), playerExtraDeck: [], botExtraDeck: [] });
  const owner = live[seat], opponent = live.getOpponent(owner);
  const source = required(owner.hand.find(card => card.id === sourceIds[scenario]));
  const step = async (action: Promise<unknown>) => { await finishChoices(live, action, scenario); return action; };
  await step(live.skipToPhase("main1"));
  const foe = required(opponent.hand.find(card => card.id === 1));
  await step(live.performNormalSummon(opponent, opponent.hand.indexOf(foe), "attack"));
  const oasis = required(opponent.hand.find(card => card.id === 354));
  await step(live.tryActivateSpell(oasis, opponent.hand.indexOf(oasis), null, { owner: opponent }));
  assert.equal(opponent.fieldSpell, oasis);
  await step(live.skipToPhase("end"));
  assert.equal(live.turn, seat); assert.equal(live.phase, "main1");
  const scout = required(owner.hand.find(card => card.id === 351));
  await step(live.performNormalSummon(owner, owner.hand.indexOf(scout), "attack"));
  const dancer = scenario === "jackal" ? required(owner.hand.find(card => card.id === 352)) : null;
  if (dancer) await step(live.tryActivateMonsterEffect(dancer, null, "hand", owner,
    { effectId: "miragebound_dancer_special_summon" }));
  const replay = async () => {
    const saved = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "miragebound-s02" }))));
    assert.equal(saved.schemaVersion, 2); assert.equal(saved.engineVersion, "engine-rules-v14");
    assert.ok(saved.commands.every(command => typeof command.stateHash === "string"));
    setLocale("pt-br");
    const result = await replayCanonicalDuel(saved, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Real Game instances use canonical setup, commands and decisions; only controller and presentation preferences are configured") });
    assert.equal(result.ok, true);
    assert.equal(result.finalStateHash, saved.result?.finalStateHash);
    assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.deepEqual(playback.materialDuelStats, live.materialDuelStats, "Ascension material progress maps must match outside the canonical snapshot");
    assert.equal(playback.decisionBroker.replayCursor, saved.decisions.length);
    assert.equal(playback.targetSelection, null);
    return saved;
  };
  return { live, owner, opponent, source, scout, dancer, foe, oasis, step, replay };
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  for (const scenario of ["jackal", "rebel"] as const) for (const removeSource of [false, true]) {
    test(`Miragebound S02 ${scenario} replays ${removeSource ? "discarded" : "intact"} hand source (${seat}, ${controller})`, async t => {
      const { live, owner, opponent, source, scout, dancer, foe, oasis, step, replay } =
        await setup(t, seat, controller, scenario, removeSource);
      const sourceVersion = source.locationVersion;
      const order: string[] = [];
      let sourceSummons = 0, sourcePositionChoices = 0;
      live.on("card_moved", event => {
        if (event.card === source && event.toZone === "graveyard") order.push("source_cost");
      });
      live.on("effect_activated", event => {
        if (event.card === source) order.push("source_activated");
      });
      live.on("spell_activated", event => {
        if (event.card?.id !== 21) return;
        assert.ok(owner.graveyard.includes(source), "the response commits its discard cost before announcement");
        order.push("response_activated");
      });
      live.on("after_summon", event => { if (event.card === source) sourceSummons++; });
      live.on("position_chosen", event => { if (event.card === source) sourcePositionChoices++; });
      const activator = scenario === "jackal" ? required(dancer) : scout;
      await step(live.tryActivateMonsterEffect(activator, null, "field", owner, {
        effectId: scenario === "jackal" ? "miragebound_dancer_bounce_buff" : "miragebound_scout_switch_position",
      }));
      assert.equal(sourceSummons, removeSource ? 0 : 1);
      assert.equal(owner.field.includes(source), !removeSource);
      assert.equal(owner.graveyard.includes(source), removeSource);
      assert.ok((source.locationVersion ?? 0) > (sourceVersion ?? 0));
      assert.equal(foe.position, scenario === "jackal" && removeSource ? "attack" : "defense",
        "Jackal changes its still-present target only after a successful summon");
      assert.equal(opponent.fieldSpell === oasis, !removeSource);
      assert.equal(opponent.graveyard.includes(oasis), removeSource);
      assert.equal(live.materialDuelStats[seat].effectActivationsByMaterialId.get(sourceIds[scenario]) ?? 0, removeSource ? 0 : 1);
      const effect = required(source.effects.find(entry => entry.id === effectIds[scenario]));
      assert.equal(live.canUseOncePerTurn(source, owner, effect).ok, false,
        "the name-wide use limit remains spent when source presence makes resolution fail");
      if (removeSource) {
        assert.deepEqual(order, ["source_activated", "source_cost", "response_activated"]);
        assert.equal(sourcePositionChoices, 0, "a withdrawn hand source creates no position decision");
      } else assert.equal(source.position, "defense");
      const saved = await replay();
      assert.ok(saved.decisions.some(decision => decision.kind === "segoc_order"));
      assert.equal(saved.decisions.filter(decision => decision.kind === "cost").length, removeSource ? 1 : 0);
      const responseDecisions = saved.decisions.filter(decision => decision.kind === "chain_response" &&
        "pass" in decision.value && decision.value.pass === false);
      assert.equal(responseDecisions.length, removeSource ? 1 : 0);
      if (removeSource) assert.equal(required(responseDecisions[0]).actorId, seat,
        "the source controller owns the response that pays the discard cost");
      const sourcePosition = saved.decisions.filter(decision => decision.kind === "choice" &&
        "candidateKey" in decision.value &&
        decision.value.candidateKey === "defense");
      assert.equal(sourcePosition.length, (scenario === "jackal" ? 1 : 0) + (removeSource ? 0 : 1),
        "only Dancer's setup and an intact hand source record position choices");
      assert.equal(saved.commands.filter(command => command.type === "activate_card").length, 1,
        "Natural Selection is a recorded Chain response inside the triggering command");
      assert.equal(saved.commands.at(-1)?.type, "activate_effect");
    });
  }
}

for (const seat of ["player", "bot"] as const) for (const scenario of ["jackal", "rebel"] as const) {
  test(`Miragebound S02 ${scenario} human source position replays under AI control in PT (${seat})`, async t => {
    const { live, owner, source, scout, dancer, step, replay } = await setup(t, seat, "human", scenario, false, "ai");
    await step(live.tryActivateMonsterEffect(scenario === "jackal" ? required(dancer) : scout, null, "field", owner, {
      effectId: scenario === "jackal" ? "miragebound_dancer_bounce_buff" : "miragebound_scout_switch_position",
    }));
    assert.ok(owner.field.includes(source)); assert.equal(source.position, "defense");
    await replay();
  });
}
