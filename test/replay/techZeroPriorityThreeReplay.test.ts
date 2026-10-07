import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_REPLAY_ENGINE_VERSION, type ReplayDriverGamePort, type SerializableValue } from "../../src/core/contracts/replay.js";
import type { DecisionMadeEventPayload } from "../../src/core/contracts/events.js";
import type { DecisionKind, DecisionRequest, DecisionResult } from "../../src/core/contracts/decisions.js";
import type { SelectionResult } from "../../src/core/contracts/selection.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState, isReplayEvent, serializeReplayEventPayload, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { DAMAGE_STEP_TIMINGS } from "../../src/core/contracts/effects.js";
import { setLocale } from "../../src/core/i18n.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Seat = "player" | "bot";
type Direction = "attack" | "defense";

function install(game: RuntimeGame, seat: Seat, controller: "human" | "ai", direction: Direction, destroyed: boolean) {
  let ready = false;
  const observed = { events: [] as { event: string; payload: SerializableValue }[], decisions: [] as DecisionMadeEventPayload[],
    requests: [] as { kind: string; actorId: string | null; candidateKeys: unknown[]; context: unknown; resultCandidateKeys: unknown[] | null; pass: boolean }[],
    stages: [] as { timing: string | null; atk: number; hash: string; snapshot: ReturnType<typeof createCanonicalStateSnapshot> }[], targeted: 0 };
  const candidateKey = (candidate: unknown): unknown => candidate && typeof candidate === "object"
    ? Reflect.get(candidate, "candidateKey") ?? Reflect.get(candidate, "key") ?? Reflect.get(candidate, "candidateId") ?? Reflect.get(candidate, "id") ?? null : null;
  const request = game.decisionBroker.requestDecision.bind(game.decisionBroker);
  function observeRequest<Kind extends DecisionKind>(input: DecisionRequest<Kind>): Promise<DecisionResult<Kind>>;
  function observeRequest(): Promise<SelectionResult | null>;
  async function observeRequest<Kind extends DecisionKind>(input?: DecisionRequest<Kind>): Promise<DecisionResult<Kind> | SelectionResult | null> {
    if (!input) return request();
    const result = await request(input);
    if (ready) observed.requests.push({ kind: input.kind, actorId: input.actor?.id ?? input.actorId ?? null,
      candidateKeys: (input.candidates || []).map(candidateKey), context: structuredClone(input.contextSnapshot ?? null),
      resultCandidateKeys: Array.isArray(result) ? result.map(candidateKey) : null, pass: result == null });
    return result;
  }
  game.decisionBroker.requestDecision = observeRequest;
  const record = game.recordReplayEvent.bind(game);
  game.recordReplayEvent = (event, payload) => {
    if (ready && isReplayEvent(event)) observed.events.push({ event, payload: serializeReplayEventPayload(game, payload) ?? null });
    return record(event, payload);
  };
  game.on("decision_made", decision => { if (ready) observed.decisions.push(structuredClone(decision)); });
  game.on("effect_targeted", () => { if (ready) observed.targeted++; });
  game.on("damage_step_timing", step => {
    const ghost = [...game[seat].field, ...game[seat].graveyard].find(card => card.id === 511);
    if (ready && ghost) observed.stages.push({ timing: step.timing, atk: ghost.atk,
      hash: hashCanonicalGameState(game), snapshot: createCanonicalStateSnapshot(game) });
  });
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    const opponentSeat = seat === "player" ? "bot" : "player";
    game.turn = direction === "attack" ? seat : opponentSeat;
    game.phase = "battle"; game.battleStep = "battle"; game.turnCounter = 4;
    game.disablePresentationDelays = true; game.phaseDelayMs = 0;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = controller;
    game.player.strategy = game.bot.strategy = null;
    for (const owner of [game.player, game.bot]) owner.deck.push(...owner.hand.splice(0));
    const owner = game[seat], opponent = game[opponentSeat];
    const ghost = required(owner.extraDeck.find(card => card.id === 511));
    owner.extraDeck.splice(owner.extraDeck.indexOf(ghost), 1);
    ghost.position = "attack"; ghost.isFacedown = false;
    ghost.lastSummonMethod = "synchro"; ghost.properSummonEstablished = true; ghost.properSummonProcedure = "synchro";
    const other = required(opponent.deck.find(card => card.id === 501));
    opponent.deck.splice(opponent.deck.indexOf(other), 1);
    other.position = "attack"; other.isFacedown = false; other.lastSummonMethod = "special";
    other.effects = []; other.atk = destroyed ? 3000 : 1000;
    placeFieldCards(owner.field, ghost); placeFieldCards(opponent.field, other);
    ready = true;
  };
  return observed;
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  for (const direction of ["attack", "defense"] as const) for (const destroyed of [false, true]) {
    test(`P3 Ghost public battle captures EN and replays PT (${seat}/${controller}/${direction}/${destroyed ? "destroyed" : "survives"})`, { timeout: 25000 }, async t => {
      setLocale("en");
      const live = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true,
        randomSeed: 51122, chainResponseTimeoutMs: 0 });
      const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false,
        replayMode: "playback", chainResponseTimeoutMs: 0 });
      t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
      const captured = install(live, seat, controller, direction, destroyed);
      const reproduced = install(playback, seat, controller, direction, destroyed);
      live.ui.showChainResponseModal = async () => null;
      live.ui.showConfirmPrompt = async () => true;
      live.ui.showTriggerOrderModal = async options => (options?.candidates || []).map(candidate => candidate.candidateId);
      live.ui.showTargetSelection = () => assert.fail("The Ghost boost uses the contextual battle opponent, not targeting");
      if (controller === "human") live.autoSelector.select = () => assert.fail("Human boosts need no AutoSelector");
      const deck = [501, ...Array<number>(12).fill(3)];
      await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
        startingPlayer: direction === "attack" ? seat : seat === "player" ? "bot" : "player", startAtDrawPhase: true,
        announceStartingPlayer: false, playerDeck: deck, botDeck: deck, playerExtraDeck: [511], botExtraDeck: [511] });
      const owner = live[seat], opponent = live[seat === "player" ? "bot" : "player"];
      const ghost = required(owner.field.find(card => card.id === 511)), other = required(opponent.field[0]);
      const action = live.resolveCombat(direction === "attack" ? ghost : other, direction === "attack" ? other : ghost);
      await completeTestSelections(live, action); await action;
      assert.equal(captured.targeted, 0);
      assert.equal(required(captured.stages.find(stage => stage.timing === DAMAGE_STEP_TIMINGS.CALCULATION)).atk, 2400);
      assert.equal(required(captured.stages.find(stage => stage.timing === DAMAGE_STEP_TIMINGS.AFTER_CALCULATION)).atk, 2400,
        "the bonus lasts through the Damage Step, beyond damage calculation");
      assert.equal(required(captured.stages.find(stage => stage.timing === DAMAGE_STEP_TIMINGS.END)).atk, 2400);
      assert.equal(owner.graveyard.includes(ghost), destroyed);
      assert.equal(owner.field.includes(ghost), !destroyed);
      assert.equal(ghost.atk, 1900, "survival or leaving the field must restore the original ATK exactly once");
      assert.equal(ghost.tempAtkBoost, 0);
      assert.equal(live.damageCalculationTempBuffs.length, 0); assert.equal(live.endOfDamageStepTempBuffs.length, 0);
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "p3_ghost_battle" }))));
      assert.deepEqual(replay.commands.map(command => command.type), ["attack"]);
      assert.equal(replay.schemaVersion, 2); assert.equal(replay.engineVersion, CANONICAL_REPLAY_ENGINE_VERSION);
      assert.equal(replay.decisions.some(decision => decision.kind === "target" || decision.kind === "target_selection"), false);
      assert.deepEqual(captured.decisions, replay.decisions.map(({ sequence: _sequence, ...decision }) => decision));
      playback.ui.showTargetSelection = () => assert.fail("Playback uses recorded decisions");
      playback.ui.showChainResponseModal = async () => assert.fail("Playback uses recorded Chain responses");
      playback.ui.showConfirmPrompt = async () => assert.fail("Playback uses recorded consent");
      playback.ui.showTriggerOrderModal = async () => assert.fail("Playback uses recorded trigger order");
      playback.autoSelector.select = () => assert.fail("Playback does not replan AI choices");
      setLocale("pt-br");
      const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
        "Concrete Game reconstructs the same public attack command and consumes canonical recorded decisions") });
      assert.equal(result.ok, true); assert.equal(result.finalStateHash, replay.result?.finalStateHash);
      assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
      assert.deepEqual(reproduced.requests, captured.requests, "compare actual broker request candidates and returned choices across EN/PT");
      assert.equal(captured.requests.length, replay.decisions.length);
      assert.deepEqual(captured.requests.map(request => ({ kind: request.kind, actorId: request.actorId,
        candidateKeys: request.candidateKeys, context: request.context, value: { orderedCandidateKeys: request.resultCandidateKeys } })),
      replay.decisions.map(decision => ({ kind: decision.kind, actorId: decision.actorId,
        candidateKeys: decision.candidateKeys, context: decision.context, value: decision.value })));
      assert.deepEqual(reproduced.decisions, [], "the replay broker consumes recorded decisions without emitting fresh live decisions");
      const damageOutcomes = captured.events.flatMap(entry => {
        if (!entry.event.startsWith("damage_step_") || !entry.payload || typeof entry.payload !== "object" || Array.isArray(entry.payload)) return [];
        const outcome: unknown = entry.payload.outcome;
        if (!outcome || typeof outcome !== "object") return [];
        const ids: unknown = Reflect.get(outcome, "destructionDuelCardIds");
        return Array.isArray(ids) ? [ids] : [];
      });
      assert.equal(damageOutcomes.some(ids => ids.includes(ghost.duelCardId)), destroyed,
        "the canonical destruction identity distinguishes the destroyed Ghost from its surviving opponent");
      const portable = (events: typeof captured.events): unknown => JSON.parse(JSON.stringify(events, (key, value: unknown) =>
        ["instanceId", "cardInstanceId", "sourceInstanceId", "destructionInstanceIds", "movedAtEndInstanceIds"].includes(key) ? undefined : value));
      assert.deepEqual(portable(reproduced.events), portable(captured.events));
      assert.deepEqual(reproduced.stages, captured.stages);
      assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
      assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
      assert.deepEqual(playback.getRandomState(), live.getRandomState());
    });
  }
}
