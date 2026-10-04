import assert from "node:assert/strict";
import test from "node:test";
import type Card from "../../src/core/Card.js";
import { setLocale } from "../../src/core/i18n.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Scenario = "rootlings" | "networks" | "armors" | "battle_attack" | "battle_defense" | "mender" | "standby" | "summon" | "germination" | "host_token" | "host_banished" | "host_borrowed" | "host_negated";
interface Fixture { sources: Card[]; host: Card | null; other: Card; spell: Card | null; }

function install(game: RuntimeGame, seat: "player" | "bot", controller: "human" | "ai", scenario: Scenario) {
  let fixture: Fixture | null = null;
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.phaseDelayMs = 0; game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = controller;
    for (const player of [game.player, game.bot]) player.deck.push(...player.hand.splice(0));
    const actor = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    const take = (player: typeof actor, id: number) => {
      const card = required(player.deck.find(entry => entry.id === id));
      player.deck.splice(player.deck.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      return card;
    };
    const other = take(opponent, 1); placeFieldCards(opponent.field, other);
    const sources: Card[] = [];
    let host: Card | null = null, spell: Card | null = null;
    if (scenario === "rootlings") {
      sources.push(take(actor, 402), take(actor, 402)); placeFieldCards(actor.field, ...sources);
    } else if (scenario === "networks") {
      sources.push(take(actor, 412), take(actor, 412)); placeFieldCards(actor.spellTrap, ...sources);
      other.addCounter("spore", 5); actor.graveyard.push(take(actor, 402));
    } else if (scenario === "armors") {
      host = take(actor, 401); placeFieldCards(actor.field, host); other.addCounter("spore", 3);
      sources.push(take(actor, 413), take(actor, 413)); actor.hand.push(...sources);
    } else if (scenario === "standby") {
      host = other;
      sources.push(take(actor, 415)); placeFieldCards(actor.spellTrap, ...sources);
      sources[0]!.equippedTo = host; game.phase = "draw";
    } else if (scenario === "summon") {
      sources.push(take(actor, 417)); placeFieldCards(actor.spellTrap, ...sources);
      host = take(opponent, 1); opponent.hand.push(host); game.turn = opponent.id;
    } else if (scenario === "germination") {
      sources.push(take(actor, 416)); sources[0]!.isFacedown = true; sources[0]!.setTurn = 3;
      placeFieldCards(actor.spellTrap, ...sources); game.turn = opponent.id; game.phase = "battle"; game.battleStep = "battle";
    } else if (scenario.startsWith("host_")) {
      if (scenario === "host_token") {
        const attacker = take(actor, 1); placeFieldCards(actor.field, attacker); sources.push(attacker);
        const trap = take(opponent, 416); trap.isFacedown = true; trap.setTurn = 3; placeFieldCards(opponent.spellTrap, trap); sources.push(trap);
        game.phase = "battle"; game.battleStep = "battle";
      }
      else { host = take(opponent, 1); placeFieldCards(opponent.field, host); }
      const equip = take(scenario === "host_borrowed" ? opponent : actor, 415);
      if (scenario === "host_borrowed") { equip.owner = equip.controller = actor.id; }
      if (scenario === "host_negated" || scenario === "host_borrowed") {
        placeFieldCards(actor.spellTrap, equip); equip.equippedTo = required(host);
        if (scenario === "host_negated") equip.effectsNegated = true;
      } else actor.hand.push(equip);
      sources.push(equip);
      if (host && scenario === "host_banished") host.banishWhenLeavesField = true;
      spell = take(actor, 21); actor.hand.push(spell, take(actor, 1));
    } else {
      host = take(actor, scenario === "mender" ? 406 : 404); placeFieldCards(actor.field, host); sources.push(host);
      other.addCounter("spore", 1);
      if (scenario === "battle_attack") { other.atk = 2500; host.atk = 3000; }
      else { other.atk = 3500; host.atk = 1000; game.turn = opponent.id; }
      game.phase = "battle"; game.battleStep = "battle";
      if (scenario === "mender") for (const card of [...actor.deck]) {
        if (card.cardKind !== "monster" || card.archetype !== "Bloomrot") continue;
        actor.deck.splice(actor.deck.indexOf(card), 1); actor.banished.push(card);
      }
    }
    game.effectEngine.updatePassiveBuffs(); fixture = { sources, host, other, spell };
  };
  return () => required(fixture);
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const)
for (const scenario of ["rootlings", "networks", "armors", "battle_attack", "battle_defense", "mender", "standby", "summon", "germination", "host_token", "host_banished", "host_borrowed", "host_negated"] as const) {
  test(`P2 canonical public-command replay (${scenario}/${seat}/${controller})`, async t => {
    setLocale("en");
    const live = createRuntimeGame({ captureReplay: true, randomSeed: 403415413, laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    const playback = createRuntimeGame({ replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
    t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
    const get = install(live, seat, controller, scenario); install(playback, seat, controller, scenario);
    live.ui.showConfirmPrompt = async () => scenario === "germination" || scenario === "host_token";
    live.ui.showChainResponseModal = async candidates => candidates.find(entry => entry.card?.id === 416) ?? null;
    live.chainSystem.botChooseChainResponse = async (_player, candidates) => candidates.find(entry => entry.card?.id === 416) ?? null;
    live.ui.showTriggerOrderModal = async options => (options?.candidates ?? []).map(entry => entry.candidateId);
    live.ui.showSpecialSummonPositionModal = (_card, done) => done("defense");
    for (const method of ["showTargetSelection", "showChainResponseModal", "showConfirmPrompt", "showTriggerOrderModal", "showSpecialSummonPositionModal"] as const)
      playback.ui[method] = () => assert.fail(`Playback cannot invoke ${method}`);
    playback.autoSelector.select = () => assert.fail("Playback cannot rerun AutoSelector");
    playback.autoSelector.orderTriggerCandidates = () => assert.fail("Playback cannot rerun trigger ordering");
    const deck = [401, 402, 402, 404, 406, 412, 412, 413, 413, 415, 416, 417, 21, 258, ...Array<number>(6).fill(1)];
    await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
      startingPlayer: seat, announceStartingPlayer: false, playerDeck: deck, botDeck: deck, playerExtraDeck: [], botExtraDeck: [] });
    const f = get(), actor = live[seat], opponent = live[seat === "player" ? "bot" : "player"];
    const targeted: string[] = [];
    live.on("effect_targeted", payload => { if (payload.effect?.id) targeted.push(payload.effect.id); });
    const run = async (action: Promise<unknown>, mode?: string) => {
      if (!mode) { await completeTestSelections(live, action); return action; }
      let done = false, failure: unknown;
      const completion = action.then(() => { done = true; }, error => { done = true; failure = error; });
      const pending = new Set<Promise<void>>();
      for (let attempt = 0; attempt < 3000; attempt++) {
        const session = live.targetSelection;
        if (session) {
          for (const requirement of session.requirements) {
            const chosen = requirement.candidates.find(candidate => candidate.cardRef?.id === mode);
            session.selections[requirement.id] = chosen ? [chosen.key] : requirement.candidates.slice(0, requirement.min).map(candidate => candidate.key);
          }
          const submitted = live.finishTargetSelection(); pending.add(submitted);
          void submitted.then(() => pending.delete(submitted), error => { failure = error; pending.delete(submitted); });
        }
        if (done && !live.targetSelection && !pending.size) break;
        await new Promise<void>(resolve => setTimeout(resolve, 1));
      }
      await completion; if (failure) throw failure;
      assert.ok(done && !live.targetSelection && !pending.size); return action;
    };
    if (scenario === "rootlings") {
      for (const source of f.sources) assert.equal((await live.tryActivateMonsterEffect(source,
        { bloomrot_rootling_spore_target: [f.other] }, "field", actor)).success, true);
      assert.equal(f.other.getCounter("spore"), 4);
    } else if (scenario === "networks") {
      for (const [index, source] of f.sources.entries()) {
        const mode = index === 0 ? "search_level_4_monster" : "recover_graveyard_card";
        const action = live.tryActivateSpellTrapEffect(source, null, { owner: actor, activationContext: {
          decisions: { cases: { bloomrot_root_network_recover: mode } },
        } });
        await run(action, mode); assert.equal((await action).success, true);
      }
      assert.equal(f.other.getCounter("spore"), 0); assert.equal(actor.hand.length, 2);
      assert.ok(actor.hand.every(card => card.archetype === "Bloomrot"));
    } else if (scenario === "armors" || scenario === "standby") {
      if (scenario === "standby") {
        await run(live.nextPhase()); assert.equal(live.phase, "standby"); assert.equal(required(f.host).getCounter("spore"), 1);
      } else {
      for (const source of f.sources) {
        const key = scenario === "armors" ? "bloomrot_fungal_armor_equip_target" : "bloomrot_overgrowth_equip_target";
        const action = live.tryActivateSpell(source, actor.hand.indexOf(source), { [key]: [required(f.host)] }, { owner: actor });
        await run(action); assert.equal((await action).success, true);
      }
      assert.deepEqual([required(f.host).atk, required(f.host).def], [1800, 2500]);
      }
    } else if (scenario === "summon") {
      await run(live.performNormalSummon(opponent, opponent.hand.indexOf(required(f.host))));
      assert.equal(required(f.host).getCounter("spore"), 1);
    } else if (scenario.startsWith("host_")) {
      let host = f.host;
      if (!host) {
        await run(live.resolveCombat(required(f.sources.find(card => card.id === 1)), f.other));
        host = required(opponent.field.find(card => card.isToken));
        await run(live.nextPhase()); assert.equal(live.phase, "main2");
      }
      const equip = required(f.sources.find(card => card.id === 415));
      if (scenario !== "host_negated" && scenario !== "host_borrowed") await run(live.tryActivateSpell(equip, actor.hand.indexOf(equip), { bloomrot_overgrowth_equip_target: [host] }, { owner: actor }));
      assert.equal(equip.equippedTo, host);
      if (scenario === "host_negated") {
        assert.equal(equip.effectsNegated, true);
      }
      const initial = f.other.getCounter("spore");
      assert.equal(live.turn, actor.id); assert.ok(live.phase === "main1" || live.phase === "main2");
      const action = live.tryActivateSpell(required(f.spell), actor.hand.indexOf(required(f.spell)), { natural_selection_cost: [required(actor.hand.find(card => card.id === 1))], natural_selection_target: [host] }, { owner: actor });
      await run(action); assert.equal((await action).success, true);
      assert.equal(f.other.getCounter("spore"), initial + (scenario === "host_negated" ? 0 : 1));
      assert.equal(opponent.field.includes(host), false);
      assert.equal((scenario === "host_borrowed" ? opponent : actor).graveyard.includes(equip), true);
    } else {
      const attacker = scenario === "battle_attack" ? required(f.host) : f.other;
      const defender = scenario === "battle_attack" ? f.other : f.host;
      await run(live.resolveCombat(attacker, defender));
      if (scenario === "mender") assert.equal(f.other.getCounter("spore"), 3);
      if (scenario === "germination") { assert.equal(f.other.getCounter("spore"), 1); assert.ok(actor.field.some(card => card.isToken)); }
    }
    for (const effect of ["bloomrot_rot_stag_attack_spore_boost", "bloomrot_rot_stag_defense_spore_boost", "bloomrot_mold_mender_attack_spores", "bloomrot_overgrowth_standby_spore_counter", "bloomrot_sudden_germination_attack", "bloomrot_rotting_ground_summon_spore_counter"])
      assert.equal(targeted.includes(effect), false, `${effect} must not declare a target`);
    const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "bloomrot-p2" }))));
    assert.equal(replay.schemaVersion, 2); assert.equal(replay.engineVersion, "engine-rules-v18");
    assert.ok(replay.commands.length > 0);
    setLocale("pt-br");
    const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game supplies identical real-card replay fixture.") });
    assert.equal(result.ok, true); assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.equal(hashCanonicalGameState(playback), hashCanonicalGameState(live));
  });
}
