import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import type { ReplayDriverGamePort, SerializableValue } from "../../src/core/contracts/replay.js";
import type { ChainCostPayment } from "../../src/core/contracts/chainRuntime.js";
import { copyCostPayment } from "../../src/core/chain/link.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState, isReplayEvent, serializeReplayEventPayload, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { setLocale } from "../../src/core/i18n.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Seat = "player" | "bot";
type Scenario = "reactor-immunity" | "singularity-immunity" | "mage-cost" | "reactor-cost";
type Controller = "human" | "ai";

function install(game: RuntimeGame, seat: Seat, scenario: Scenario, controller: Controller) {
  const events: { event: string; turn: number; phase: string; payload: SerializableValue }[] = [];
  let ready = false;
  const record = game.recordReplayEvent.bind(game);
  game.recordReplayEvent = (event, payload) => {
    if (ready && isReplayEvent(event)) events.push({ event, turn: game.turnCounter, phase: game.phase,
      payload: serializeReplayEventPayload(game, payload) ?? null });
    return record(event, payload);
  };
  const activationCostZones: boolean[] = [];
  game.on("effect_activated", payload => {
    if (payload.effectId === "tech_zero_battle_mage_recycle_revive") {
      activationCostZones.push(game[seat].graveyard.some(card => card.id === 502));
    }
  });
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.phaseDelayMs = 0; game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "human";
    game.player.strategy = game.bot.strategy = null;
    const owner = game[seat], opponent = game.getOpponent(owner);
    owner.controllerType = controller;
    for (const player of [owner, opponent]) player.deck.push(...player.hand.splice(0));
    const take = (player: Pick<typeof owner, "deck" | "extraDeck">, id: number) => {
      const zone = player.deck.some(card => card.id === id) ? player.deck : player.extraDeck;
      const card = required(zone.find(card => card.id === id));
      zone.splice(zone.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      if (card.monsterType === "synchro") {
        card.properSummonEstablished = true; card.properSummonProcedure = "synchro";
      }
      return card;
    };
    if (scenario === "mage-cost") {
      const cost = take(owner, 502);
      cost.originalLevel = 3; cost.level = 4;
      cost.levelModificationContributions = [{ amount: 1, duration: "while_faceup" }];
      placeFieldCards(owner.field, take(owner, 512), cost);
      owner.graveyard.push(take(owner, 510));
    } else if (scenario === "reactor-cost") {
      const reactor = take(owner, 515);
      reactor.summonedTurn = 3; reactor.banishWhenLeavesField = true;
      placeFieldCards(owner.field, reactor);
      owner.graveyard.push(take(owner, 509));
    } else {
      const materials = scenario === "reactor-immunity" ? [501, 514] : [503, 510, 511];
      placeFieldCards(owner.field, ...materials.map(id => take(owner, id)));
      placeFieldCards(opponent.field, take(opponent, 275));
      if (scenario === "singularity-immunity") {
        placeFieldCards(opponent.spellTrap, take(opponent, 519));
        opponent.fieldSpell = take(opponent, 518);
      }
    }
    ready = true;
  };
  return { events, activationCostZones };
}

test("paid scalar evidence survives detached copies, Chain serialization and physical card mutation", t => {
  const game = createRuntimeGame({ captureReplay: false });
  t.after(() => game.dispose());
  // Bounded product: absent canonical identity, Unicode/escaped names, low/high
  // Levels, multiple ordered entries and multiple reference groups.
  for (const identity of [null, 7, 101]) for (const name of ["Paid card", "Nome ç \"\n", ""]) {
    for (const level of [0, 1, 3.5, 4, 12]) {
      const physicalCard = new Card(cardDefinition(502), "player");
      physicalCard.name = name; physicalCard.level = level;
      const payment: ChainCostPayment = { status: "paid", actions: [], paidReferences: {
        second: [{ cardDuelCardId: 2, name: "Second", level: 3 }],
        cost: [{ cardDuelCardId: identity, name: physicalCard.name, level: physicalCard.level },
          { cardDuelCardId: 9, name: "Other", level: 5 }],
      } };
      const expected = structuredClone(payment);
      const copied = copyCostPayment(payment);
      const link = game.chainSystem.createChainLink({ controller: game.player, costPayment: payment });
      const serialized = required(game.chainSystem.serializeChainLink(link));
      assert.deepEqual(serialized.costPayment, expected);
      assert.deepEqual(JSON.parse(JSON.stringify(serializeReplayEventPayload(game, { costPayment: copied }))),
        { costPayment: expected });
      game.chainSystem.chainStack = [link];
      const before = hashCanonicalGameState(game);
      physicalCard.name = "Changed after payment"; physicalCard.level = level + 1;
      required(required(payment.paidReferences).cost).splice(0, 1,
        { cardDuelCardId: 999, name: "Changed physical values", level: level + 1 });
      required(payment.paidReferences).second = [];
      assert.deepEqual(copied, expected);
      assert.deepEqual(link.costPayment, expected);
      assert.deepEqual(serialized.costPayment, expected);
      assert.equal(hashCanonicalGameState(game), before);
      for (const first of [
        { cardDuelCardId: identity, name, level: level + 1 },
        { cardDuelCardId: identity, name: `${name} changed`, level },
        { cardDuelCardId: (identity ?? 0) + 1, name, level },
      ]) {
        const serializedChange = structuredClone(serialized);
        const entries = required(required(required(serializedChange.costPayment).paidReferences).cost);
        entries[0] = first;
        assert.notEqual(hashCanonicalGameState({ chainSystem: { getChainSummary: () => [serializedChange] } }),
          hashCanonicalGameState({ chainSystem: { getChainSummary: () => [serialized] } }));
      }
      required(required(serialized.costPayment).paidReferences).cost = [];
      assert.deepEqual(link.costPayment, expected, "A serialized payment does not alias the live Chain link");
    }
  }
  assert.equal(Object.hasOwn(copyCostPayment({ status: "not_required", actions: [] }), "paidReferences"), false);
});

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  for (const scenario of ["reactor-immunity", "singularity-immunity", "mage-cost", "reactor-cost"] as const) {
    test(`Tech-Zero P1 ${scenario} records real Chain and EN/PT playback (${seat}/${controller})`, { timeout: 20000 }, async t => {
      setLocale("en");
      const live = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: true,
        randomSeed: 512515517, chainResponseTimeoutMs: 0 });
      const playback = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false,
        replayMode: "playback", chainResponseTimeoutMs: 0 });
      t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
      const observed = install(live, seat, scenario, controller);
      const reproduced = install(playback, seat, scenario, controller);
      live.ui.showConfirmPrompt = async () => true;
      live.ui.showTriggerOrderModal = async options => options?.optional ? []
        : (options?.candidates || []).map(candidate => candidate.candidateId);
      live.ui.showChainResponseModal = async () => null;
      live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("attack");
      if (controller === "human") live.autoSelector.select = () => assert.fail("Human selections belong to the broker");
      const deck = [501, 502, 507, 518, 519, ...Array<number>(15).fill(3)];
      const extra = [275, 503, 509, 510, 511, 512, 514, 515, 517];
      await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
        startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
        playerDeck: deck, botDeck: deck, playerExtraDeck: extra, botExtraDeck: extra });
      const owner = live[seat], opponent = live.getOpponent(owner);
      const cost = owner.field.find(card => card.id === 502);
      const source = scenario.endsWith("immunity")
        ? required(owner.extraDeck.find(card => card.id === (scenario === "reactor-immunity" ? 515 : 517)))
        : required(owner.field.find(card => card.id === (scenario === "mage-cost" ? 512 : 515)));
      const action = scenario.endsWith("immunity")
        ? live.performSynchroSummonFromExtraDeck(source, owner, { materials: [...owner.field] })
        : live.tryActivateMonsterEffect(source, null, "field", owner, {
          effectId: scenario === "mage-cost" ? "tech_zero_battle_mage_recycle_revive" : "tech_zero_reactor_dragon_recycle_synchros",
        });
      await completeTestSelections(live, action);
      const result = await action;
      if (scenario === "reactor-cost") {
        assert.equal(result.success, false, "A redirected send must fail the Graveyard cost");
        assert.ok(owner.graveyard.some(card => card.id === 509));
        assert.equal(owner.field.some(card => card.id === 509), false);
      } else {
        assert.equal(result.success, true);
        if (scenario === "mage-cost") {
          assert.deepEqual(observed.activationCostZones, [true], "Cost must be paid before activation publication");
          assert.ok(owner.graveyard.includes(required(cost)));
          assert.equal(cost?.level, 3, "Presence level resets on leaving the field");
          assert.ok(owner.field.some(card => card.id === 510), "Revival uses the paid Level 4 snapshot");
        } else {
          assert.equal(required(opponent.field.find(card => card.id === 275)).effectsNegated, false);
          if (scenario === "singularity-immunity") {
            assert.equal(required(opponent.spellTrap.find(card => card.id === 519)).effectsNegated, true);
            assert.equal(required(opponent.fieldSpell).effectsNegated, true);
          }
        }
      }
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: scenario }))));
      assert.equal(replay.commands.length, 1, "Internal costs and summons are not external commands");
      assert.equal(replay.commands[0]?.actorId, seat);
      assert.equal(replay.schemaVersion, 2);
      if (scenario !== "reactor-cost") assert.ok(replay.decisions.length > 0);
      if (scenario === "mage-cost") {
        const selections = replay.decisions.filter(decision =>
          JSON.stringify(decision.value).includes("tech_zero_battle_mage_"));
        assert.equal(selections.length, 2, "Cost and resolution choices are separate broker decisions");
        assert.ok(JSON.stringify(required(selections[0]).value).includes("tech_zero_battle_mage_cost"));
        assert.ok(JSON.stringify(required(selections[1]).value).includes("tech_zero_battle_mage_revive_target"));
      }
      playback.ui.showTargetSelection = () => assert.fail("Playback must consume recorded selections");
      playback.ui.showConfirmPrompt = async () => assert.fail("Playback must consume consent");
      playback.ui.showTriggerOrderModal = async () => assert.fail("Playback must consume trigger ordering");
      playback.ui.showChainResponseModal = async () => assert.fail("Playback must consume Chain responses");
      playback.ui.showSpecialSummonPositionModal = () => assert.fail("Playback must consume position");
      playback.autoSelector.select = () => assert.fail("Playback must not rerun AI choices");
      setLocale("pt-br");
      const played = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
        "Concrete Game uses real Chain and the same deterministic setup in another runtime.") });
      assert.equal(played.ok, true);
      assert.equal(played.finalStateHash, replay.result?.finalStateHash);
      assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
      // Legacy diagnostic payloads still contain process-local instance IDs.
      // Compare every recorded event and scalar after excluding only those IDs.
      const portableEvents = (events: typeof observed.events) => JSON.stringify(events, (key, value: unknown) =>
        ["instanceId", "cardInstanceId", "sourceInstanceId"].includes(key) ? undefined : value);
      assert.equal(portableEvents(reproduced.events), portableEvents(observed.events), "Portable canonical events replay in order");
      assert.deepEqual(reproduced.activationCostZones, observed.activationCostZones);
      assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
      assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
      assert.deepEqual(playback.getRandomState(), live.getRandomState());
    });
  }
}
