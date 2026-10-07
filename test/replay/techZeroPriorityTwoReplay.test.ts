import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_REPLAY_ENGINE_VERSION, type ReplayDriverGamePort, type SerializableValue } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, getCardDatabaseSignature, hashCanonicalGameState, isReplayEvent, serializeReplayEventPayload, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { setLocale } from "../../src/core/i18n.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Seat = "player" | "bot";
type Scenario = "core" | "machine" | "raptor" | "prism" | "scrapyard" | "scrapyard-negated" | "scrapyard-cl2" | "mage-full" | "lab" | "copies" |
  "glider" | "pulse" | "glider-negated" | "pulse-negated" | "glider-cancel" | "pulse-cancel";

function install(game: RuntimeGame, seat: Seat, controller: "human" | "ai", scenario: Scenario) {
  let ready = false;
  const events: { event: string; payload: SerializableValue }[] = [];
  const record = game.recordReplayEvent.bind(game);
  game.recordReplayEvent = (event, payload) => {
    if (ready && isReplayEvent(event)) events.push({ event, payload: serializeReplayEventPayload(game, payload) ?? null });
    return record(event, payload);
  };
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.phaseDelayMs = 0; game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "human";
    game.player.strategy = game.bot.strategy = null;
    const owner = game[seat]; owner.controllerType = controller;
    for (const player of [game.player, game.bot]) player.deck.push(...player.hand.splice(0));
    const take = (id: number) => {
      const zone = owner.deck.some(card => card.id === id) ? owner.deck : owner.extraDeck;
      const card = required(zone.find(card => card.id === id)); zone.splice(zone.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      if (card.monsterType === "synchro") { card.properSummonEstablished = true; card.properSummonProcedure = "synchro"; }
      return card;
    };
    if (scenario.startsWith("glider") || scenario.startsWith("pulse")) {
      const id = scenario.startsWith("glider") ? 504 : 508;
      owner.hand.push(take(id), take(id), take(id));
      if (id === 504) placeFieldCards(owner.field, take(501));
      if (scenario.endsWith("negated")) {
        const opponent = game.getOpponent(owner);
        const negator = required(opponent.extraDeck.find(card => card.id === 275));
        opponent.extraDeck.splice(opponent.extraDeck.indexOf(negator), 1);
        negator.isFacedown = false; negator.position = "attack";
        negator.properSummonEstablished = true; negator.properSummonProcedure = "graveyard_banish_fusion";
        placeFieldCards(opponent.field, negator);
      }
    } else if (scenario === "core") {
      placeFieldCards(owner.field, take(504)); owner.hand.push(take(502), take(501));
    } else if (scenario === "machine") {
      placeFieldCards(owner.field, take(502), take(503));
    } else if (scenario === "raptor") {
      const core = take(501);
      core.name = "Tech-Zero Raptor Token"; core.isToken = true; core.isTuner = false; core.effects = [];
      placeFieldCards(owner.field, take(505), take(506), core, take(504), take(504));
    } else if (scenario === "prism") {
      placeFieldCards(owner.field, take(501), take(506)); owner.hand.push(take(504));
    } else if (scenario === "scrapyard" || scenario === "scrapyard-negated" || scenario === "scrapyard-cl2") {
      placeFieldCards(owner.field, take(506)); owner.graveyard.push(take(501));
      const trap = take(520); trap.isFacedown = true; trap.setTurn = 2; trap.turnSetOn = 2;
      placeFieldCards(owner.spellTrap, trap);
      if (scenario === "scrapyard-cl2") placeFieldCards(owner.field, take(503));
      if (scenario === "scrapyard-negated") {
        const opponent = game[seat === "player" ? "bot" : "player"];
        const negator = required(opponent.extraDeck.find(card => card.id === 275));
        opponent.extraDeck.splice(opponent.extraDeck.indexOf(negator), 1);
        negator.isFacedown = false; negator.position = "attack";
        negator.properSummonEstablished = true; negator.properSummonProcedure = "graveyard_banish_fusion";
        placeFieldCards(opponent.field, negator);
      }
    } else if (scenario === "mage-full") {
      placeFieldCards(owner.field, take(512), take(503), take(507), take(507), take(507));
      owner.graveyard.push(take(502));
    } else if (scenario === "lab") {
      owner.hand.push(take(518)); owner.graveyard.push(take(503), take(501), take(504));
    } else {
      placeFieldCards(owner.field, take(512), take(512), take(503), take(503)); owner.graveyard.push(take(502), take(502));
    }
    ready = true;
  };
  return events;
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  test(`P2 direct Scrapyard captures in EN and replays in PT (${seat}/${controller})`, async t => {
    setLocale("en");
    const live = createRuntimeGame({ disableChains: true, laboratoryMode: true, laboratoryUseBot: false,
      captureReplay: true, randomSeed: 52021 });
    const playback = createRuntimeGame({ disableChains: true, laboratoryMode: true, laboratoryUseBot: false,
      captureReplay: false, replayMode: "playback" });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    const captured = install(live, seat, controller, "scrapyard"), reproduced = install(playback, seat, controller, "scrapyard");
    live.ui.showConfirmPrompt = live.ui.showTrapActivationModal = async () => true;
    live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
    live.ui.showTriggerOrderModal = async options => (options?.candidates || []).map(candidate => candidate.candidateId);
    if (controller === "human") live.autoSelector.select = () => assert.fail("Direct human choices use the broker");
    const deck = [501, 504, 506, 520, ...Array<number>(10).fill(3)];
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startingPlayer: seat, startAtDrawPhase: true, announceStartingPlayer: false,
      playerDeck: deck, botDeck: deck, playerExtraDeck: [503], botExtraDeck: [503] });
    const owner = live[seat], source = required(owner.spellTrap[0]);
    const action = live.tryActivateSpellTrapEffect(source, null, { owner });
    await completeTestSelections(live, action); assert.equal((await action).success, true);
    assert.ok(owner.field.some(card => card.id === 503)); assert.ok(owner.graveyard.includes(source));
    assert.equal(live.afterResolutionActivation, null);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "p2_direct_scrapyard" }))));
    assert.ok(replay.decisions.length > 0);
    playback.ui.showTargetSelection = () => assert.fail("Direct playback consumes recorded selections");
    playback.ui.showConfirmPrompt = playback.ui.showTrapActivationModal = async () => assert.fail("Direct playback consumes consent");
    playback.ui.showSpecialSummonPositionModal = () => assert.fail("Direct playback consumes positions");
    playback.autoSelector.select = () => assert.fail("Direct playback consumes AI decisions");
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Concrete direct/Null Game reconstructs the same deterministic setup and recorded decisions.") });
    assert.equal(result.ok, true); assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    const portable = (events: typeof captured) => JSON.stringify(events, (key, value: unknown) =>
      ["instanceId", "cardInstanceId", "sourceInstanceId"].includes(key) ? undefined : value);
    assert.equal(portable(reproduced), portable(captured));
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.deepEqual(playback.getRandomState(), live.getRandomState());
  });
}

test("Tech-Zero hand procedures use the current engine version with schema 2 retained", () => {
  assert.equal(CANONICAL_REPLAY_ENGINE_VERSION, "engine-rules-v24");
});

test("v23 rejects the previous rules and declaration signature independently before playback mutation", async t => {
  const live = createRuntimeGame({ captureReplay: true, laboratoryMode: true });
  const playback = createRuntimeGame({ replayMode: "playback", laboratoryMode: true });
  t.after(() => { live.dispose(); playback.dispose(); });
  const valid = required(live.finalizeReplay({ reason: "techzero-procedure-compatibility" }));
  assert.equal(valid.schemaVersion, 2); assert.equal(valid.cardDatabaseSignature, getCardDatabaseSignature());
  const before = createCanonicalStateSnapshot(playback);
  for (const [invalid, message] of [
    [{ ...valid, engineVersion: "engine-rules-v22" }, /engineVersion/],
    [{ ...valid, cardDatabaseSignature: "f60cba87" }, /card database signature/],
  ] as const) {
    assert.throws(() => validateCanonicalReplay(invalid), message);
    await assert.rejects(() => replayCanonicalDuel(invalid, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Concrete Game supplies canonical replay ports; compatibility rejection must precede bootstrap mutations.") }), message);
    assert.deepEqual(createCanonicalStateSnapshot(playback), before);
  }
});

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  for (const scenario of ["core", "machine", "raptor", "prism", "scrapyard", "scrapyard-negated", "scrapyard-cl2", "mage-full", "lab", "copies"] as const) {
    test(`P2 ${scenario} captures canonical decisions in EN and replays in PT (${seat}/${controller})`, { timeout: 25000 }, async t => {
      setLocale("en");
      const live = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true,
        randomSeed: 501520, chainResponseTimeoutMs: 0 });
      const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false,
        replayMode: "playback", chainResponseTimeoutMs: 0 });
      t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
      const captured = install(live, seat, controller, scenario), reproduced = install(playback, seat, controller, scenario);
      live.ui.showConfirmPrompt = live.ui.showTrapActivationModal = async () => true;
      live.ui.showTriggerOrderModal = async options => (options?.candidates || []).map(candidate => candidate.candidateId);
      live.ui.showChainResponseModal = async () => null;
      live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
      if (controller === "human") live.autoSelector.select = () => assert.fail("Human selections must use the decision broker");
      const deck = [501, 501, 501, 502, 502, 504, 504, 504, 504, 505, 506, 507, 507, 507, 507, 518, 518, 520, ...Array<number>(12).fill(3)];
      const extra = [503, 503, 503, 510, 512, 512, 513, 275];
      await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
        startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
        playerDeck: deck, botDeck: deck, playerExtraDeck: extra, botExtraDeck: extra });
      const owner = live[seat];
      let mageActivations = 0;
      live.on("effect_activated", event => { if (event.effectId === "tech_zero_battle_mage_recycle_revive") mageActivations++; });
      let usedResponse = false;
      let scrapCompleted = 0;
      const completedEffects: string[] = [];
      let coreResolving = false;
      const coreChoicesDuringResolution: boolean[] = [], coreTargets: number[] = [];
      live.on("effect_targeted", event => {
        if (event.effectId === "tech_zero_electrocatapult_normal_summon" || event.effect?.id === "tech_zero_electrocatapult_normal_summon") {
          if (event.target?.duelCardId) coreTargets.push(event.target.duelCardId);
        }
      });
      live.on("decision_made", event => {
        const selections = Reflect.get(event.value, "selections");
        if (selections && typeof selections === "object" && Object.keys(selections).some(key => key.startsWith("tech_zero_electrocatapult_"))) {
          coreChoicesDuringResolution.push(coreResolving);
        }
      });
      live.on("chain_link_resolution", event => {
        if (event.effectId === "tech_zero_electrocatapult_normal_summon" && event.stage === "resolving") coreResolving = true;
        if (event.stage !== "completed") return;
        completedEffects.push(event.effectId || "");
        if (event.effectId === "tech_zero_scrapyard_activation") scrapCompleted++;
      });
      if (scenario === "scrapyard-negated" || scenario === "scrapyard-cl2") {
        const chooseResponse = async <Candidate extends { readonly card?: { readonly id?: number | string | null | undefined } | undefined }>(candidates: readonly Candidate[],
          context: { type?: string | null | undefined } | null | undefined): Promise<Candidate | null> => {
          const id = scenario === "scrapyard-negated" ? 275 : 520;
          const permitted = scenario === "scrapyard-negated" ? context?.type === "summon_attempt" : context?.type !== "summon_attempt";
          const candidate = permitted && !usedResponse ? candidates.find(entry => entry.card?.id === id) : undefined;
          if (candidate) {
            usedResponse = true;
            if (id === 275) {
              assert.equal(scrapCompleted, 1);
              const snapshot = createCanonicalStateSnapshot(live);
              assert.ok(snapshot.chain.afterResolution, "CL1 snapshots preserve the suspended parent phase");
              assert.equal(live.chainSystem.suspendedChainFrames.length, 1);
              assert.ok(owner.spellTrap.some(card => card.id === 520));
            }
            return candidate;
          }
          return null;
        };
        live.ui.showChainResponseModal = chooseResponse;
        live.chainSystem.botChooseChainResponse = (_player, candidates, context) => chooseResponse(candidates, context);
      }
      const finish = async (action: Promise<unknown>) => { await completeTestSelections(live, action); return action; };
      if (scenario === "core") {
        await finish(live.performNormalSummon(owner, 0));
        assert.deepEqual(coreTargets, [], "Electrocatapult does not declare activation targets for its Normal Summon trigger");
        assert.deepEqual(coreChoicesDuringResolution, [true], "the physical summon candidate is chosen only while the Chain link resolves");
        assert.ok(owner.field.some(card => card.id === 501));
      }
      else if (scenario === "machine") await finish(live.tryActivateMonsterEffect(required(owner.field.find(card => card.id === 503)), null,
        "field", owner, { effectId: "tech_zero_multimodal_machine_level_mod" }));
      else if (scenario === "raptor" || scenario === "prism") {
        const boss = required(owner.extraDeck.find(card => card.id === (scenario === "raptor" ? 513 : 503)));
        await finish(live.performSynchroSummonFromExtraDeck(boss, owner, { materials: owner.field.slice(0, scenario === "raptor" ? 3 : 2) }));
        if (scenario === "raptor") assert.equal(owner.field.filter(card => card.isToken).length, 2);
        else assert.ok(owner.field.some(card => card.id === 504 && card.effectsNegated));
      } else if (scenario === "scrapyard" || scenario === "scrapyard-negated" || scenario === "scrapyard-cl2") {
        let attempts = 0;
        const timing = live.chainSystem.runFastEffectTiming.bind(live.chainSystem);
        live.chainSystem.runFastEffectTiming = input => {
          if (input?.origin === "summon_attempt") attempts++;
          return timing(input);
        };
        if (scenario === "scrapyard-cl2") {
          await finish(live.tryActivateMonsterEffect(required(owner.field.find(card => card.id === 503)), null, "field", owner,
            { effectId: "tech_zero_multimodal_machine_level_mod" }));
        } else await finish(live.tryActivateSpellTrapEffect(required(owner.spellTrap.find(card => card.id === 520)), null, { owner }));
        if (scenario === "scrapyard-negated") {
          assert.equal(usedResponse, true);
          assert.ok(owner.graveyard.some(card => card.monsterType === "synchro"));
          assert.equal(owner.field.filter(card => card.monsterType === "synchro").length, 0);
        } else assert.ok(owner.field.some(card => card.monsterType === "synchro"));
        if (scenario === "scrapyard-cl2") {
          assert.equal(usedResponse, true);
          assert.equal(attempts, 0);
          assert.ok(completedEffects.indexOf("tech_zero_scrapyard_activation") < completedEffects.indexOf("tech_zero_multimodal_machine_level_mod"));
        } else assert.equal(attempts, 1);
      } else if (scenario === "lab") {
        const returnedSynchro = required(owner.graveyard.find(card => card.id === 503));
        await finish(live.tryActivateSpell(required(owner.hand[0]), 0, null, { owner }));
        assert.equal(owner.fieldSpell?.id, 518);
        await finish(Promise.resolve(live.activateFieldSpellEffect(required(owner.fieldSpell))));
        assert.ok(owner.extraDeck.includes(returnedSynchro));
        assert.ok(!owner.graveyard.includes(returnedSynchro));
      } else {
        for (const source of owner.field.filter(card => card.id === 512)) {
          await finish(live.tryActivateMonsterEffect(source, null, "field", owner, { effectId: "tech_zero_battle_mage_recycle_revive" }));
        }
        assert.equal(mageActivations, scenario === "copies" ? 2 : 1);
        if (scenario === "mage-full") assert.equal(owner.field.filter(card => card.id === 502).length, 1);
      }
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: `p2_${scenario}` }))));
      assert.equal(replay.schemaVersion, 2); assert.equal(replay.engineVersion, "engine-rules-v24");
      assert.ok(replay.commands.length > 0); assert.ok(replay.decisions.length > 0);
      playback.ui.showTargetSelection = () => assert.fail("Playback must consume recorded target/choice decisions");
      playback.ui.showConfirmPrompt = playback.ui.showTrapActivationModal = async () => assert.fail("Playback must consume recorded consent");
      playback.ui.showTriggerOrderModal = async () => assert.fail("Playback must consume recorded trigger order");
      playback.ui.showChainResponseModal = async () => assert.fail("Playback must consume recorded Chain responses");
      playback.ui.showSpecialSummonPositionModal = () => assert.fail("Playback must consume recorded positions");
      playback.autoSelector.select = () => assert.fail("Playback must consume recorded AI decisions");
      setLocale("pt-br");
      const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
        "Concrete Game reproduces the deterministic P2 setup through public actions and real Chain.") });
      assert.equal(result.ok, true); assert.equal(result.finalStateHash, replay.result?.finalStateHash);
      assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
      const portable = (events: typeof captured) => JSON.stringify(events, (key, value: unknown) =>
        ["instanceId", "cardInstanceId", "sourceInstanceId"].includes(key) ? undefined : value);
      assert.equal(portable(reproduced), portable(captured));
      assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
      assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
      assert.deepEqual(playback.getRandomState(), live.getRandomState());
    });
  }
}

for (const id of [504, 508] as const) for (const seat of ["player", "bot"] as const)
for (const controller of ["human", "ai"] as const) for (const outcome of ["success", "negated", "cancel"] as const) {
  test(`Tech-Zero ${id} hand procedure replays ${outcome} with a named success limit (${seat}/${outcome === "cancel" ? `human to ${controller}` : controller})`, async t => {
    setLocale("en");
    const name = id === 504 ? "glider" : "pulse";
    const scenario: Scenario = outcome === "success" ? name : `${name}-${outcome}`;
    const live = createRuntimeGame({ captureReplay: true, laboratoryMode: true, laboratoryUseBot: false,
      randomSeed: 504508, chainResponseTimeoutMs: 0, getFieldPlacementMode: () => "manual",
      fieldPlacementProvider: async () => outcome === "cancel" ? { outcome: "cancelled" } : { outcome: "chosen", slot: 4 } });
    const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0,
      getFieldPlacementMode: () => assert.fail("Playback must not read placement preferences"),
      fieldPlacementProvider: async () => assert.fail("Playback must consume recorded placement") });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    const captured = install(live, seat, outcome === "cancel" ? "human" : controller, scenario), reproduced = install(playback, seat, controller, scenario);
    live.ui.showConfirmPrompt = async () => true;
    live.ui.showTriggerOrderModal = async options => (options?.candidates ?? []).map(candidate => candidate.candidateId);
    live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
    let usedNegator = false;
    const chooseResponse = async <Candidate extends { readonly card?: { readonly id?: number | string | null | undefined } | undefined }>(
      candidates: readonly Candidate[], context: { type?: string | null | undefined } | null | undefined,
    ): Promise<Candidate | null> => {
      const candidate = outcome === "negated" && !usedNegator && context?.type === "summon_attempt"
        ? candidates.find(entry => entry.card?.id === 275) : undefined;
      if (candidate) usedNegator = true;
      return candidate ?? null;
    };
    live.ui.showChainResponseModal = chooseResponse;
    live.chainSystem.botChooseChainResponse = (_player, candidates, context) => chooseResponse(candidates, context);
    const deck = [501, 504, 504, 504, 508, 508, 508, ...Array<number>(13).fill(3)];
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
      startingPlayer: seat, announceStartingPlayer: false, playerDeck: deck, botDeck: deck,
      playerExtraDeck: [275], botExtraDeck: [275] });
    const owner = live[seat], first = required(owner.hand[0]), second = required(owner.hand[1]), third = required(owner.hand[2]);
    const activations: number[] = [];
    live.on("effect_activated", event => { if (typeof event.card.id === "number") activations.push(event.card.id); });
    const run = async (source: typeof first) => {
      const pending = live.performHandSummonProcedure(source, owner);
      await completeTestSelections(live, pending);
      return pending;
    };
    const firstResult = await run(first);
    if (outcome === "cancel") {
      assert.equal(firstResult.cancelled, true);
      assert.ok(owner.hand.includes(first));
      assert.equal(live.canSummonFromHandByProcedure(second, owner).ok, true);
    } else {
      if (outcome === "negated") {
        assert.equal(firstResult.summonNegated, true); assert.equal(usedNegator, true);
        assert.ok(owner.graveyard.includes(first));
        assert.equal(live.canSummonFromHandByProcedure(second, owner).ok, true, "negation preserves the name-shared limit");
        assert.equal((await run(second)).success, true);
      } else assert.equal(firstResult.success, true);
      const summoned = outcome === "negated" ? second : first;
      assert.ok(owner.field.includes(summoned));
      assert.equal(summoned.lastSummonProcedure, id === 504 ? "tech_zero_glider_wyvern_special_summon" : "tech_zero_pulse_soldier_empty_field_summon");
      assert.equal(live.canSummonFromHandByProcedure(third, owner).reason, "hand_procedure_used_this_turn", "success blocks all copies by the procedure limit");
    }
    assert.deepEqual(activations, outcome === "negated" ? [275] : [], "the procedure creates no effect activation");
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: `procedure_${id}_${outcome}` }))));
    assert.deepEqual(replay.commands.map(command => command.type), outcome === "negated"
      ? ["hand_summon_procedure", "hand_summon_procedure"] : ["hand_summon_procedure"]);
    assert.equal(replay.decisions.some(decision => decision.kind === "cost"), false, "both procedures are costless");
    for (const method of ["showTargetSelection", "showChainResponseModal", "showConfirmPrompt", "showSpecialSummonPositionModal", "showTriggerOrderModal"] as const) {
      playback.ui[method] = () => assert.fail(`Playback must consume ${method} decisions`);
    }
    playback.autoSelector.select = () => assert.fail("Playback must consume recorded AI choices");
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Separate real Games bootstrap identical fixtures and execute the public hand procedure with recorded decisions.") });
    assert.equal(result.ok, true); assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    const portable = (events: typeof captured) => JSON.stringify(events, (key, value: unknown) =>
      ["instanceId", "cardInstanceId", "sourceInstanceId"].includes(key) ? undefined : value);
    assert.equal(portable(reproduced), portable(captured));
    assert.deepEqual(playback.getRandomState(), live.getRandomState());
  });
}
