import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../../src/core/Card.js";
import type { PlayerId } from "../../src/core/contracts/primitives.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { chooseSpecialSummonPosition } from "../../src/core/effects/activation/positionChoice.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Scenario = "dancer" | "scout" | "mirror" | "oasis_return" | "oasis_shift";
type Controller = "human" | "ai";
const cases = { oasis_return: "miragebound_oasis_return_weaken", oasis_shift: "miragebound_oasis_shift_weaken" } as const;

function installFixture(game: RuntimeGame, seat: PlayerId, controller: Controller, scenario: Scenario) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    const owner = game[seat], opponent = game.getOpponent(owner);
    owner.controllerType = controller;
    if (scenario === "dancer" && controller === "ai") owner.strategy = {
      chooseSpecialSummonPosition: () => game.replayMode === "playback"
        ? assert.fail("Playback must consume Dancer's recorded position without consulting the AI policy")
        : "defense",
    };
    for (const player of [owner, opponent]) { player.deck = [...player.hand, ...player.deck]; player.hand = []; }
    const take = (player: Pick<typeof owner, "deck">, id: number) => {
      const card = required(player.deck.find(candidate => candidate.id === id));
      player.deck.splice(player.deck.indexOf(card), 1);
      return card;
    };
    if (scenario === "dancer") {
      owner.hand.push(take(owner, 352)); placeFieldCards(owner.field, take(owner, 351));
    } else if (scenario === "scout") owner.hand.push(take(owner, 351));
    else if (scenario === "mirror") {
      placeFieldCards(owner.spellTrap, take(owner, 359)); opponent.fieldSpell = take(opponent, 354);
    } else {
      owner.fieldSpell = take(owner, 354); placeFieldCards(owner.field, take(owner, 351));
    }
    placeFieldCards(opponent.field, take(opponent, 351));
  };
}

async function finishChoices(game: RuntimeGame, action: Promise<unknown>, caseId: string | null, cancel = false) {
  let done = false, failure: unknown, cancelled = false;
  const completion = action.then(() => { done = true; }, error => { done = true; failure = error; });
  const callbacks = new Set<Promise<void>>();
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session) {
      if (cancel && session.kind === "choice" && !cancelled) { cancelled = true; game.cancelTargetSelection(); }
      else {
        for (const requirement of session.requirements) {
          const selected = caseId && requirement.candidates.find(candidate => candidate.cardRef?.id === caseId);
          session.selections[requirement.id] = selected ? [selected.key] : requirement.candidates.slice(0, requirement.min).map(candidate => candidate.key);
        }
        const resolution = game.finishTargetSelection(); callbacks.add(resolution);
        void resolution.then(() => callbacks.delete(resolution), error => { callbacks.delete(resolution); failure = error; });
      }
    }
    if (done && !game.targetSelection && callbacks.size === 0) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done && !game.targetSelection && callbacks.size === 0, "all selections must finish");
  await completion;
  if (failure) throw failure;
  if (cancel) assert.equal(cancelled, true);
}

async function setup(t: TestContext, seat: PlayerId, controller: Controller, scenario: Scenario, playbackController: Controller = controller) {
  const live = createRuntimeGame({ captureReplay: true, randomSeed: 435, laboratoryMode: true, laboratoryUseBot: false,
    chainResponseTimeoutMs: 0, getFieldPlacementMode: () => "manual",
    fieldPlacementProvider: async () => ({ outcome: "chosen", slot: 4 }) });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false,
    chainResponseTimeoutMs: 0, getFieldPlacementMode: () => assert.fail("Playback must not consult placement preferences"),
    fieldPlacementProvider: async () => assert.fail("Playback must not ask for placement") });
  t.after(() => { live.dispose(); playback.dispose(); });
  installFixture(live, seat, controller, scenario);
  installFixture(playback, seat, playbackController, scenario);
  live.ui.showConfirmPrompt = async () => true;
  live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
  live.ui.showChainResponseModal = async () => null;
  playback.ui.showConfirmPrompt = async () => assert.fail("Playback must not ask for confirmation");
  playback.ui.showChainResponseModal = async () => assert.fail("Playback must not ask for Chain responses");
  playback.ui.showSpecialSummonPositionModal = () => assert.fail("Playback must not ask for position");
  playback.ui.showTargetSelection = () => assert.fail("Playback must not ask for targets or modes");
  playback.autoSelector.select = () => assert.fail("Playback must not rerun AI target or mode selection");
  const deck = [351, 352, 354, 359, 360, ...Array<number>(15).fill(3)];
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
    startingPlayer: seat, announceStartingPlayer: false, playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
  const owner = live[seat], opponent = live.getOpponent(owner);
  const source = required(scenario.startsWith("oasis") ? owner.fieldSpell : scenario === "mirror" ? owner.spellTrap[0] : owner.hand[0]);
  const caseId = scenario === "oasis_return" || scenario === "oasis_shift" ? cases[scenario] : null;
  if (controller === "ai" && caseId) {
    const select = live.autoSelector.select.bind(live.autoSelector);
    live.autoSelector.select = (contract, context) => select(contract, { ...required(context), activationContext: {
      ...context?.activationContext, decisions: { ...context?.activationContext?.decisions, cases: { miragebound_oasis_ignition: caseId } },
    } });
  }
  const activate = async () => {
    if (scenario === "dancer") return live.tryActivateMonsterEffect(source, null, "hand", owner, { effectId: "miragebound_dancer_special_summon" });
    if (scenario === "scout") return live.performNormalSummon(owner, 0, "attack");
    if (scenario === "mirror") return live.tryActivateSpellTrapEffect(source, null, { owner });
    return live.activateFieldSpellEffect(source);
  };
  const replay = async () => {
    const saved = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "miragebound-p1" }))));
    assert.equal(saved.schemaVersion, 2); assert.equal(saved.engineVersion, "engine-rules-v18");
    const result = await replayCanonicalDuel(saved, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Both concrete Games receive the same deterministic fixture before replayed commands execute") });
    assert.equal(result.finalStateHash, saved.result?.finalStateHash);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.deepEqual(playback.materialDuelStats, live.materialDuelStats, "material progress maps must also match outside the canonical snapshot");
    assert.equal(playback.decisionBroker.replayCursor, saved.decisions.length);
    return saved;
  };
  return { live, owner, opponent, source, caseId, activate, replay };
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  for (const scenario of ["dancer", "scout", "mirror", "oasis_return", "oasis_shift"] as const) {
    test(`Miragebound P1 replay preserves ${scenario} (${seat}, ${controller})`, async t => {
      const { live, owner, opponent, source, caseId, activate, replay } = await setup(t, seat, controller, scenario);
      const order: string[] = [];
      live.on("decision_made", event => { order.push(event.kind); });
      live.on("activation_transaction", event => { if (event.duelCardId === source.duelCardId) order.push(event.stage); });
      live.on("effect_activated", event => {
        if (event.card !== source) return;
        if (scenario === "mirror") assert.ok(owner.graveyard.includes(source), "source cost is paid before responses");
        if (scenario === "oasis_return") assert.equal(owner.field.length, 1, "return is an effect during resolution");
        order.push("announced");
      });
      const action = activate(); await finishChoices(live, action, caseId);
      if (scenario === "dancer") {
        assert.ok(owner.field.includes(source)); assert.equal(owner.field.length, 2);
        assert.equal(source.position, "defense");
        if (controller === "human") assert.equal(source.fieldSlot, 4);
      } else if (scenario === "scout") {
        assert.ok(owner.field.includes(source)); assert.ok(owner.hand.some(card => card.cardKind !== "monster" && card.archetype === "Miragebound"));
        assert.equal(live.materialDuelStats[seat].effectActivationsByMaterialId.get(351), 1);
        const ignition = live.tryActivateMonsterEffect(source, null, "field", owner, { effectId: "miragebound_scout_switch_position" });
        await finishChoices(live, ignition, null);
        assert.equal((await ignition).success, true, (await ignition).reason ?? undefined);
        assert.equal(live.materialDuelStats[seat].effectActivationsByMaterialId.get(351), 2);
        assert.equal(live.materialDuelStats[opponent.id].effectActivationsByMaterialId.get(351), undefined);
      } else if (scenario === "mirror") {
        assert.ok(owner.graveyard.includes(source)); assert.equal(opponent.fieldSpell, null);
        assert.ok(opponent.graveyard.some(card => card.id === 354));
      } else {
        assert.equal(required(opponent.field[0]).atk, 1000);
        if (scenario === "oasis_return") assert.ok(owner.hand.some(card => card.id === 351));
        else assert.equal(required(opponent.field[0]).position, "defense");
        assert.ok(order.indexOf("choice") >= 0 && order.indexOf("choice") < order.indexOf("source_committed"));
      }
      const saved = await replay();
      if (scenario === "dancer") assert.ok(saved.decisions.some(decision => decision.kind === "choice" &&
        "candidateKey" in decision.value && decision.value.candidateKey === "defense"), "Dancer's selected position must be recorded for either controller");
      if (caseId) assert.ok(JSON.stringify(saved.decisions.find(decision => decision.kind === "choice")?.value).includes(caseId));
      assert.equal(saved.commands.length, scenario === "scout" ? 2 : 1);
    });
  }
}

for (const seat of ["player", "bot"] as const) test(`Miragebound P1 replay preserves Oasis precommit cancellation (${seat})`, async t => {
  const { live, owner, source, caseId, activate, replay } = await setup(t, seat, "human", "oasis_return");
  let activations = 0; live.on("effect_activated", event => { if (event.card === source) activations++; });
  const action = activate(); await finishChoices(live, action, caseId, true);
  assert.equal(activations, 0); assert.equal(owner.field.length, 1);
  assert.equal(live.effectEngine.canActivateFieldSpellEffectPreview(source, owner).ok, true);
  const saved = await replay(); assert.equal(saved.decisions.length, 1); assert.equal(saved.decisions[0]?.kind, "choice");
});

for (const seat of ["player", "bot"] as const) test(`Dancer human position replays with an AI controller without consulting policy (${seat})`, async t => {
  const { live, owner, source, activate, replay } = await setup(t, seat, "human", "dancer", "ai");
  const action = activate(); await finishChoices(live, action, null);
  assert.ok(owner.field.includes(source)); assert.equal(source.position, "defense");
  const saved = await replay();
  assert.ok(saved.decisions.some(decision => decision.kind === "choice" && "candidateKey" in decision.value &&
    decision.value.candidateKey === "defense"), "the human position decision must be consumed by the AI-configured playback");
});

for (const position of ["attack", "defense"] as const) test(`Forced Special Summon position ${position} bypasses broker, strategy and UI`, async () => {
  const card = new Card(cardDefinition(352), "bot");
  const player = unsafeFixture<Parameters<typeof chooseSpecialSummonPosition>[1]>({ id: "bot", controllerType: "ai",
    strategy: { chooseSpecialSummonPosition: () => assert.fail("A forced position must not consult policy") } },
  "The position resolver observes only controller identity and the strategy hook on this intentionally minimal player");
  const observed: string[] = [];
  const resolved = await chooseSpecialSummonPosition.call({ game: {
    requestDecision: async () => assert.fail("A forced position must not create a decision"),
    notify: (_event, payload) => { observed.push(payload.position); },
  }, ui: { showSpecialSummonPositionModal: () => assert.fail("A forced position must not request UI") } }, card, player, { position });
  assert.equal(resolved, position); assert.deepEqual(observed, [position]);
});

test("Special Summon position preserves AI policy and default in hosts without a broker", async () => {
  const card = new Card(cardDefinition(352), "bot");
  const player = unsafeFixture<Parameters<typeof chooseSpecialSummonPosition>[1]>({ id: "bot", controllerType: "ai",
    strategy: { chooseSpecialSummonPosition: () => "defense" } },
  "The legacy no-broker host deliberately contains only the fields read by the position resolver");
  const host = { game: {}, ui: { showSpecialSummonPositionModal: () => assert.fail("AI never requests human UI") } };
  assert.equal(await chooseSpecialSummonPosition.call(host, card, player, { position: "choice" }), "defense");
  delete player.strategy;
  assert.equal(await chooseSpecialSummonPosition.call(host, card, player), "attack");
});
