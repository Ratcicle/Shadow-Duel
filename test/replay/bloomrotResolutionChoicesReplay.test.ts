import assert from "node:assert/strict";
import test from "node:test";
import type Card from "../../src/core/Card.js";
import { CANONICAL_REPLAY_ENGINE_VERSION, type ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { setLocale } from "../../src/core/i18n.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Seat = "player" | "bot";
type Scenario = "carrioncap_battle" | "widow_destroyed" | "husk_ignition" | "husk_destroyed" | "armor_grave";
const cases = {
  carrioncap_battle: { cardId: 405, effectId: "bloomrot_carrioncap_battle_destroy_spore_counter", choiceId: "bloomrot_carrioncap_battle_spore_target" },
  widow_destroyed: { cardId: 407, effectId: "bloomrot_gravecap_widow_destroyed_infected_spore", choiceId: "bloomrot_gravecap_widow_spore_target" },
  husk_ignition: { cardId: 408, effectId: "bloomrot_ancient_husk_ignition_spore_counters", choiceId: "bloomrot_ancient_husk_spore_targets" },
  husk_destroyed: { cardId: 408, effectId: "bloomrot_ancient_husk_destroyed_infected_spore", choiceId: "bloomrot_ancient_husk_destroy_spore_targets" },
  armor_grave: { cardId: 413, effectId: "bloomrot_fungal_armor_grave_spore_counter", choiceId: "bloomrot_fungal_armor_spore_target" },
} as const;
interface Fixture { source: Card; victim: Card | null; spell: Card | null; discard: Card | null; recipients: Card[]; }

function install(game: RuntimeGame, seat: Seat, controller: "human" | "ai", scenario: Scenario) {
  let fixture: Fixture | null = null;
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.phase = scenario === "carrioncap_battle" ? "battle" : "main1";
    game.battleStep = scenario === "carrioncap_battle" ? "battle" : null;
    game.turnCounter = 4; game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = controller;
    for (const player of [game.player, game.bot]) player.deck.push(...player.hand.splice(0));
    const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    const take = (player: typeof owner, id: number) => {
      const card = required(player.deck.find(entry => entry.id === id));
      player.deck.splice(player.deck.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      return card;
    };
    const source = take(owner, cases[scenario].cardId);
    if (scenario !== "armor_grave") placeFieldCards(owner.field, source);
    else placeFieldCards(owner.spellTrap, source);
    const recipients = Array.from({ length: scenario.startsWith("husk") ? 2 : 1 }, () => take(opponent, 1));
    for (const recipient of recipients) Object.assign(recipient, { cannotBeTargeted: true });
    placeFieldCards(opponent.field, ...recipients);
    let victim: Card | null = null, spell: Card | null = null, discard: Card | null = null;
    if (scenario !== "husk_ignition") {
      victim = take(scenario === "armor_grave" ? owner : opponent, scenario === "armor_grave" ? 402 : 1);
      if (scenario !== "armor_grave") victim.addCounter("spore", 1);
      placeFieldCards((scenario === "armor_grave" ? owner : opponent).field, victim);
      if (scenario === "carrioncap_battle") { source.atk = 2500; victim.atk = 1000; }
      else {
        const caster = scenario === "armor_grave" ? opponent : owner;
        spell = take(caster, 21); discard = take(caster, 1); caster.hand.push(spell, discard);
        game.turn = caster.id;
      }
      if (scenario === "armor_grave") source.equippedTo = victim;
    }
    game.effectEngine.updatePassiveBuffs(); fixture = { source, victim, spell, discard, recipients };
  };
  return () => required(fixture);
}

async function drive(game: RuntimeGame, action: Promise<unknown>, fixture: Fixture,
  scenario: Scenario, observeChoice: () => void) {
  let done = false, failure: unknown;
  const completion = action.then(() => { done = true; }, error => { failure = error; done = true; });
  const pending = new Set<Promise<void>>();
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session) {
      for (const requirement of session.requirements) {
        if (requirement.id === cases[scenario].choiceId) {
          observeChoice();
          assert.equal(session.kind, "choice");
          assert.ok(fixture.recipients.every(card => requirement.candidates.some(candidate => candidate.cardRef === card)),
            "non-targeting choices include the protected physical recipients");
          session.selections[requirement.id] = requirement.candidates
            .filter(candidate => fixture.recipients.some(card => candidate.cardRef === card))
            .map(candidate => candidate.key);
        } else {
          const exact = requirement.id === "natural_selection_target" ? fixture.victim
            : requirement.id === "natural_selection_cost" ? fixture.discard : null;
          const candidate = exact ? requirement.candidates.find(entry => entry.cardRef === exact) : null;
          session.selections[requirement.id] = candidate ? [candidate.key]
            : requirement.candidates.slice(0, requirement.min).map(entry => entry.key);
        }
      }
      const resolution = game.finishTargetSelection(); pending.add(resolution);
      void resolution.then(() => pending.delete(resolution), error => { failure = error; pending.delete(resolution); });
    }
    if (done && !game.targetSelection && !pending.size) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done && !game.targetSelection && !pending.size, "all choices finish within the public command");
  await completion; if (failure) throw failure;
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const)
for (const scenario of ["carrioncap_battle", "widow_destroyed", "husk_ignition", "husk_destroyed", "armor_grave"] as const) {
  test(`T01 resolution-choice canonical replay (${scenario}/${seat}/${controller})`, async t => {
    setLocale("en");
    const live = createRuntimeGame({ captureReplay: true, randomSeed: 405407408413, laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    const playback = createRuntimeGame({ replayMode: "playback", laboratoryMode: true,
      laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    const get = install(live, seat, controller, scenario); install(playback, seat, controller, scenario);
    live.ui.showConfirmPrompt = async () => true;
    live.ui.showChainResponseModal = async () => null;
    live.ui.showTriggerOrderModal = async options => (options?.candidates ?? []).map(entry => entry.candidateId);
    for (const method of ["showTargetSelection", "showChainResponseModal", "showConfirmPrompt", "showTriggerOrderModal", "showSpecialSummonPositionModal"] as const)
      playback.ui[method] = () => assert.fail(`Playback must not invoke ${method}`);
    playback.autoSelector.select = () => assert.fail("Playback must consume recorded selections");
    playback.autoSelector.orderTriggerCandidates = () => assert.fail("Playback must consume recorded trigger order");
    const deck = [402, 405, 407, 408, 413, 21, ...Array<number>(12).fill(1)];
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
      startingPlayer: seat, announceStartingPlayer: false, playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
    const fixture = get(), owner = live[seat], config = cases[scenario];
    let activated = false, choiceCount = 0;
    const targeted: string[] = [];
    live.on("effect_activated", payload => { if (payload.effect?.id === config.effectId) activated = true; });
    live.on("effect_targeted", payload => { if (payload.effect?.id) targeted.push(payload.effect.id); });
    const observeChoice = () => {
      choiceCount++;
      assert.equal(activated, true, "the effect is published before this choice");
      const link = required(live.chainSystem.currentResolvingLink);
      assert.equal(link.effect?.id, config.effectId,
        "Spore recipients are chosen during resolution, after the response window");
      assert.equal(link.declaredTargets?.length ?? 0, 0);
      assert.equal(link.declaredTargetSnapshots?.length ?? 0, 0);
    };
    const select = live.autoSelector.select.bind(live.autoSelector);
    live.autoSelector.select = (contract, context) => {
      const requirements = "requirements" in contract && Array.isArray(contract.requirements) ? contract.requirements : [];
      const isChoice = requirements.some(requirement => requirement.id === config.choiceId);
      if (isChoice) {
        observeChoice();
        const requirement = required(requirements.find(entry => entry.id === config.choiceId));
        assert.ok(fixture.recipients.every(card => requirement.candidates?.some(candidate => candidate.cardRef === card)));
      }
      const selections = isChoice ? { [config.choiceId]: fixture.recipients.map(card => card.instanceId) }
        : requirements.some(requirement => requirement.id === "natural_selection_target")
          ? { natural_selection_target: [required(fixture.victim).instanceId] } : {};
      return select(contract, { ...context, owner: context?.owner ?? owner,
        selectionContract: context?.selectionContract ?? contract, selectionKind: context?.selectionKind ?? "target",
        activationContext: { ...context?.activationContext,
        decisions: { ...context?.activationContext?.decisions, selections } } });
    };
    const caster = scenario === "armor_grave" ? live[seat === "player" ? "bot" : "player"] : owner;
    const action = scenario === "husk_ignition" ? live.tryActivateMonsterEffect(fixture.source, null, "field", owner)
      : scenario === "carrioncap_battle" ? live.resolveCombat(fixture.source, required(fixture.victim))
      : live.tryActivateSpell(required(fixture.spell), caster.hand.indexOf(required(fixture.spell)), null, { owner: caster });
    await drive(live, action, fixture, scenario, observeChoice);
    assert.equal(activated, true); assert.equal(choiceCount, 1);
    assert.equal(targeted.includes(config.effectId), false, "choosing a recipient must not emit effect_targeted");
    for (const recipient of fixture.recipients) assert.equal(recipient.getCounter("spore"), 1);
    if (scenario === "armor_grave") assert.ok(owner.graveyard.includes(fixture.source));
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "bloomrot-resolution-choices" }))));
    assert.equal(replay.schemaVersion, 2); assert.equal(replay.engineVersion, CANONICAL_REPLAY_ENGINE_VERSION);
    assert.equal(replay.commands.length, 1);
    const decision = required(replay.decisions.find(entry => "selections" in entry.value &&
      Object.hasOwn(entry.value.selections, config.choiceId)));
    assert.equal(decision.kind, "choice"); assert.equal(decision.actorId, owner.id);
    if ("selections" in decision.value) assert.equal(decision.value.selections[config.choiceId]?.length, fixture.recipients.length);
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Concrete Game supplies the same public-command fixture and canonical decision port.") });
    assert.equal(result.ok, true); assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
  });
}
