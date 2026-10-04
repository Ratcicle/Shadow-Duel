import assert from "node:assert/strict";
import test from "node:test";
import type Card from "../../src/core/Card.js";
import { CANONICAL_REPLAY_ENGINE_VERSION, type ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { setLocale } from "../../src/core/i18n.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Seat = "player" | "bot";
type Scenario = "sporeling" | "queen" | "moldmender_battle" | "devourer_banished" | "widow_opponent" | "widow_self";
interface Fixture {
  victim: Card;
  spell: Card | null;
  attacker: Card | null;
  mine: Card | null;
  theirs: Card | null;
  recruits: Card[];
  wrongRecruit: Card | null;
}

function install(game: RuntimeGame, seat: Seat, controller: "human" | "ai", scenario: Scenario) {
  let fixture: Fixture | null = null;
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    const castByOwner = scenario === "widow_opponent";
    game.turn = castByOwner ? seat : opponent.id;
    game.phase = scenario === "moldmender_battle" ? "battle" : "main1";
    game.battleStep = scenario === "moldmender_battle" ? "battle" : null;
    game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = controller;
    for (const player of [game.player, game.bot]) player.deck.push(...player.hand.splice(0));
    const take = (player: typeof owner, id: number) => {
      const zone = player.deck.some(card => card.id === id) ? player.deck : player.extraDeck;
      const card = required(zone.find(candidate => candidate.id === id));
      zone.splice(zone.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      return card;
    };
    const victims = { sporeling: 401, queen: 419, moldmender_battle: 406,
      devourer_banished: 420, widow_opponent: 1, widow_self: 1 } as const;
    const widow = scenario.startsWith("widow") ? take(owner, 407) : null;
    if (widow) placeFieldCards(owner.field, widow);
    // Ownership and control intentionally differ before the recorded command.
    const originalOwner = scenario === "widow_opponent" ? owner : opponent;
    const priorController = scenario === "widow_opponent" ? opponent : owner;
    const victim = take(originalOwner, victims[scenario]);
    victim.owner = victim.controller = priorController.id;
    if (scenario.startsWith("widow")) victim.addCounter("spore", 1);
    if (scenario === "devourer_banished") victim.banishWhenLeavesField = true;
    placeFieldCards(priorController.field, victim);
    let mine: Card | null = null, theirs: Card | null = null;
    const recruits: Card[] = [];
    let wrongRecruit: Card | null = null;
    if (scenario === "queen") {
      mine = take(owner, 1); theirs = take(opponent, 1);
      placeFieldCards(owner.field, mine); placeFieldCards(opponent.field, theirs);
    }
    if (scenario.startsWith("widow")) { theirs = take(opponent, 1); placeFieldCards(opponent.field, theirs); }
    if (scenario === "moldmender_battle") {
      const recruit = take(owner, 402); recruits.push(recruit); owner.hand.push(recruit);
      wrongRecruit = take(opponent, 402); opponent.hand.push(wrongRecruit);
      // Keep one eligible physical recruit so AI and human decisions prove the
      // actor's pool without depending on the strategy's recruitment ranking.
      for (const card of [...owner.deck]) {
        if (card.cardKind !== "monster" || card.archetype !== "Bloomrot") continue;
        owner.deck.splice(owner.deck.indexOf(card), 1); owner.banished.push(card);
      }
    }
    if (scenario === "devourer_banished") {
      for (const id of [402, 404]) { const recruit = take(owner, id); recruits.push(recruit); owner.graveyard.push(recruit); }
      wrongRecruit = take(opponent, 402); opponent.graveyard.push(wrongRecruit);
    }
    let spell: Card | null = null, attacker: Card | null = null;
    if (scenario === "moldmender_battle") {
      attacker = take(opponent, 1); attacker.atk = 3500; attacker.addCounter("spore", 4);
      placeFieldCards(opponent.field, attacker);
    } else {
      const caster = castByOwner ? owner : opponent;
      spell = take(caster, 21); caster.hand.push(spell, take(caster, 1));
    }
    fixture = { victim, spell, attacker, mine, theirs, recruits, wrongRecruit };
    game.effectEngine.updatePassiveBuffs();
  };
  return () => required(fixture);
}

async function drive(game: RuntimeGame, action: Promise<unknown>, victim: Card) {
  let done = false, failure: unknown;
  const completion = action.then(() => { done = true; }, error => { done = true; failure = error; });
  const pending = new Set<Promise<void>>();
  for (let attempt = 0; attempt < 4000; attempt++) {
    const session = game.targetSelection;
    if (session) {
      for (const requirement of session.requirements) {
        const desired = requirement.id === "natural_selection_target"
          ? requirement.candidates.find(candidate => candidate.cardRef === victim) : null;
        const amount = requirement.id === "field_placement" ? requirement.min
          : requirement.id === "natural_selection_target" || requirement.id === "natural_selection_cost" ? requirement.min : requirement.max;
        session.selections[requirement.id] = desired ? [desired.key]
          : requirement.candidates.slice(0, amount).map(candidate => candidate.key);
      }
      const resolution = game.finishTargetSelection(); pending.add(resolution);
      void resolution.then(() => pending.delete(resolution), error => { failure = error; pending.delete(resolution); });
    }
    if (done && !game.targetSelection && !pending.size) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done && !game.targetSelection && !pending.size, "the public command must finish with all broker choices consumed");
  await completion;
  if (failure) throw failure;
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const)
for (const scenario of ["sporeling", "queen", "moldmender_battle", "devourer_banished", "widow_opponent", "widow_self"] as const) {
  test(`P1 destruction and historical-controller canonical replay (${scenario}, ${seat}, ${controller})`, async t => {
    setLocale("en");
    const live = createRuntimeGame({ captureReplay: true, randomSeed: 401420407, laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    const playback = createRuntimeGame({ replayMode: "playback", laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    const liveFixture = install(live, seat, controller, scenario);
    install(playback, seat, controller, scenario);
    live.ui.showChainResponseModal = async () => null;
    live.ui.showConfirmPrompt = async () => true;
    live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
    for (const method of ["showTargetSelection", "showChainResponseModal", "showConfirmPrompt", "showSpecialSummonPositionModal"] as const) {
      playback.ui[method] = () => assert.fail(`Playback must consume recorded ${method} decisions`);
    }
    playback.autoSelector.select = () => assert.fail("Playback must consume recorded AI selections");
    const deck = [21, 401, 406, 407, 402, 402, 404, 410, 1, 1, 1, 1, ...Array<number>(8).fill(1)];
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
      startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
      playerDeck: deck, botDeck: deck, playerExtraDeck: [419, 420], botExtraDeck: [419, 420] });
    const f = liveFixture(), owner = live[seat], opponent = live[seat === "player" ? "bot" : "player"];
    if (controller === "ai" && f.spell) {
      const select = live.autoSelector.select.bind(live.autoSelector);
      live.autoSelector.select = (contract, context) => select(contract, context?.effect?.id === "natural_selection_activation"
        ? { ...context, activationContext: { ...context.activationContext, decisions: { ...context.activationContext?.decisions,
          selections: { ...context.activationContext?.decisions?.selections, natural_selection_target: [f.victim.instanceId] } } } }
        : context);
    }
    const caster = scenario === "widow_opponent" ? owner : opponent;
    const action = f.attacker ? live.resolveCombat(f.attacker, f.victim)
      : live.tryActivateSpell(required(f.spell), caster.hand.indexOf(required(f.spell)), null, { owner: caster });
    await drive(live, action, f.victim);
    if (scenario === "sporeling") { assert.ok(owner.hand.some(card => card.id === 410)); assert.equal(opponent.hand.some(card => card.id === 410), false); }
    if (scenario === "queen") { assert.equal(required(f.mine).getCounter("spore"), 0); assert.equal(required(f.theirs).getCounter("spore"), 1); }
    if (scenario === "moldmender_battle" || scenario === "devourer_banished") {
      assert.ok(f.recruits.every(card => owner.field.includes(card)));
      assert.equal(opponent.field.includes(required(f.wrongRecruit)), false);
    }
    if (scenario.startsWith("widow")) assert.equal(required(f.theirs).getCounter("spore"), scenario === "widow_opponent" ? 1 : 0);
    const destination = scenario === "widow_opponent" ? owner : opponent;
    assert.ok((scenario === "devourer_banished" ? destination.banished : destination.graveyard).includes(f.victim));
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "bloomrot-p1-trigger" }))));
    assert.equal(replay.engineVersion, CANONICAL_REPLAY_ENGINE_VERSION);
    assert.equal(replay.schemaVersion, 2); assert.equal(replay.commands.length, 1);
    assert.equal(replay.commands[0]?.type, scenario === "moldmender_battle" ? "attack" : "activate_card");
    assert.ok(replay.decisions.length > 0);
    if (scenario === "sporeling" || scenario === "moldmender_battle" || scenario === "devourer_banished") {
      assert.ok(replay.decisions.some(decision => decision.actorId === owner.id), "the previous controller owns the benefit decisions");
    }
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Concrete Game implements the canonical command, setup, and decision ports.") });
    assert.equal(result.ok, true); assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
  });
}
