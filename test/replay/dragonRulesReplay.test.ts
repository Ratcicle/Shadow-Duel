import assert from "node:assert/strict";
import test from "node:test";
import { setLocale } from "../../src/core/i18n.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Scenario = "luminous" | "crystal" | "bull" | "peak" | "abyssal" | "rainbow" | "protection" | "galaxy" | "armored" | "mist"
  | "roar-empty" | "roar-zero" | "roar-one" | "mist-bounce-monster" | "mist-bounce-backrow" | "soft-opt"
  | "forest-standby-self" | "forest-standby-opponent" | "metal-own-summon" | "metal-opponent-summon"
  | "sanctuary-attack" | "sanctuary-effect";

function install(game: RuntimeGame, scenario: Scenario, seat: "player" | "bot", controller: "human" | "ai") {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.turnCounter = 4; game.phase = "main1";
    game.battleStep = "battle"; game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    const owner = game[seat], opponent = game[seat === "player" ? "bot" : "player"];
    owner.controllerType = controller;
    for (const player of [owner, opponent]) {
      player.deck = [...player.hand, ...player.deck]; player.hand = [];
    }
    const take = (id: number, player = owner) => {
      const card = required(player.deck.find(card => card.id === id));
      player.deck.splice(player.deck.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack";
      return card;
    };
    if (scenario === "forest-standby-self" || scenario === "forest-standby-opponent") {
      game.phase = "end";
      game.turn = scenario === "forest-standby-self" ? opponent.id : owner.id;
      placeFieldCards(owner.field, take(274));
      placeFieldCards(opponent.field, take(254, opponent));
      const backrow = take(261, opponent); backrow.isFacedown = true;
      placeFieldCards(opponent.spellTrap, backrow);
      opponent.fieldSpell = take(262, opponent);
      opponent.hand.push(take(251, opponent), take(255, opponent));
    } else if (scenario === "metal-own-summon" || scenario === "metal-opponent-summon") {
      const material = take(252); material.summonedTurn = 0;
      placeFieldCards(owner.field, material);
      if (scenario === "metal-own-summon") owner.hand.push(take(255));
      else {
        opponent.controllerType = controller;
        placeFieldCards(opponent.field, take(254, opponent));
        opponent.hand.push(take(255, opponent));
      }
    } else if (scenario === "sanctuary-attack" || scenario === "sanctuary-effect") {
      game.turn = opponent.id;
      if (scenario === "sanctuary-attack") game.phase = "battle";
      const dragon = take(254); dragon.originalLevel = dragon.level; dragon.level = 9;
      placeFieldCards(owner.field, dragon);
      placeFieldCards(opponent.field, take(257, opponent));
      const trap = take(268); trap.isFacedown = true; trap.turnSetOn = trap.setTurn = 1;
      placeFieldCards(owner.spellTrap, trap);
      owner.hand.push(take(251));
    } else if (scenario === "luminous") {
      owner.hand.push(take(251));
    } else if (scenario === "crystal") {
      owner.hand.push(take(264)); owner.graveyard.push(take(251), take(254), take(255));
    } else if (scenario === "bull") {
      owner.hand.push(take(259), take(254), take(255)); placeFieldCards(owner.field, take(251));
    } else if (scenario === "peak") {
      const peak = take(262); peak.addCounter("dragon_peak", 7); owner.fieldSpell = peak;
    } else if (scenario === "abyssal") {
      placeFieldCards(owner.field, take(263)); placeFieldCards(opponent.field, take(257, opponent));
    } else if (scenario === "rainbow") {
      const rainbow = required(owner.extraDeck.shift()); owner.graveyard.push(rainbow);
    } else if (scenario === "protection") {
      placeFieldCards(owner.field, required(owner.extraDeck.shift()), take(255));
    } else if (scenario === "mist") {
      placeFieldCards(opponent.field, take(272, opponent)); owner.hand.push(take(255));
    } else if (scenario.startsWith("roar-")) {
      owner.hand.push(take(261)); placeFieldCards(owner.field, take(257));
      if (scenario !== "roar-empty") {
        const backrow = take(261, opponent); backrow.isFacedown = true;
        placeFieldCards(opponent.spellTrap, backrow);
      }
    } else if (scenario === "mist-bounce-monster" || scenario === "mist-bounce-backrow") {
      placeFieldCards(owner.field, take(272));
      const target = take(scenario === "mist-bounce-monster" ? 254 : 261, opponent);
      target.isFacedown = true; target.position = "defense";
      if (scenario === "mist-bounce-monster") placeFieldCards(opponent.field, target);
      else placeFieldCards(opponent.spellTrap, target);
    } else if (scenario === "soft-opt") {
      placeFieldCards(owner.field, take(257), take(257)); placeFieldCards(opponent.field, take(254, opponent));
    } else {
      game.phase = "battle"; game.turn = opponent.id;
      placeFieldCards(owner.field, take(scenario === "galaxy" ? 273 : 252));
      const attacker = take(259, opponent); attacker.atk = 4000;
      placeFieldCards(opponent.field, attacker);
      const drawn = take(255); owner.deck.push(drawn);
    }
  };
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const scenario of ["luminous", "crystal", "bull", "peak", "abyssal", "rainbow", "protection", "galaxy", "armored", "mist",
      "roar-empty", "roar-zero", "roar-one", "mist-bounce-monster", "mist-bounce-backrow", "soft-opt",
      "forest-standby-self", "forest-standby-opponent", "metal-own-summon", "metal-opponent-summon",
      "sanctuary-attack", "sanctuary-effect"] as const) {
      test(`Dragon ${scenario} ${seat} ${controller} records and replays in another instance`, async t => {
        setLocale("en");
        const live = createRuntimeGame({ captureReplay: true, randomSeed: 629, laboratoryMode: true,
          laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
        const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true,
          laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
        t.after(() => { live.dispose(); playback.dispose(); setLocale("en"); });
        install(live, scenario, seat, controller); install(playback, scenario, seat, controller);
        live.ui.showConfirmPrompt = async () => true;
        live.ui.showChainResponseModal = async candidates =>
          candidates.find(candidate => candidate.card?.id === 268) || null;
        if (scenario.startsWith("sanctuary-")) {
          live.chainSystem.botChooseChainResponse = async (_player, candidates) =>
            candidates.find(candidate => candidate.card.id === 268) || null;
        }
        live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
        playback.ui.showConfirmPrompt = async () => assert.fail("Replay cannot request confirmation");
        playback.ui.showChainResponseModal = async () => assert.fail("Replay cannot request a response");
        playback.ui.showSpecialSummonPositionModal = () => assert.fail("Replay cannot request position");
        playback.autoSelector.select = () => assert.fail("Replay cannot recompute an AI selection");
        playback.chainSystem.botChooseChainResponse = async () => assert.fail("Replay cannot recompute a Chain response");
        playback.ui.showTargetSelection = () => assert.fail("Replay cannot request a card choice");
        const deck = [251, 252, 254, 255, 257, 257, 259, 261, 262, 263, 264, 270, 271, 272, 273, 274, ...Array<number>(8).fill(3)];
        if (scenario.startsWith("sanctuary-")) deck.push(268);
        await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
          startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
          playerDeck: deck, botDeck: deck, playerExtraDeck: [267, 253], botExtraDeck: [267, 253] });
        const owner = live[seat], opponent = live.getOpponent(owner);
        const select = live.autoSelector.select.bind(live.autoSelector);
        live.autoSelector.select = (contract, context) => {
          if (!contract || !("requirements" in contract)) return select(contract, context);
          const normalized = live.normalizeSelectionContract(contract);
          if (!normalized.ok) return select(contract, context);
          const requirement = normalized.contract.requirements.find(requirement => requirement.id === "destroy_targets");
          if (!requirement) return select(contract, context);
          return { ok: true, selections: { destroy_targets: scenario === "roar-one" ? [required(requirement.candidates[0]).key] : [] } };
        };
        const metalAction = async () => {
          const ascension = await live.tryAscensionSummon(required(owner.field[0]), { player: owner });
          assert.equal(ascension.success, true);
          if (scenario === "metal-opponent-summon") {
            await live.skipToPhase("end");
          }
          const actor = scenario === "metal-opponent-summon" ? opponent : owner;
          assert.equal(live.turn, actor.id);
          assert.equal(live.phase, "main1");
          return live.tryActivateMonsterEffect(required(actor.hand.find(card => card.id === 255)), null, "hand", actor,
            { effectId: "voltaic_dragon_special_summon" });
        };
        const action = scenario.startsWith("forest-standby-") ? live.nextPhase()
          : scenario.startsWith("metal-") ? metalAction()
          : scenario === "luminous" || scenario === "crystal" ? live.performHandSummonProcedure(required(owner.hand[0]), owner, { position: "defense" })
          : scenario === "bull" ? live.tryActivateMonsterEffect(required(owner.hand[0]), null, "hand", owner, { effectId: "bbd_special_summon_from_hand" })
          : scenario === "peak" ? live.activateFieldSpellEffect(required(owner.fieldSpell))
          : scenario === "rainbow" ? live.tryActivateMonsterEffect(required(owner.graveyard[0]), null, "graveyard", owner, { effectId: "rainbow_cosmic_dragon_gy_send_extremes" })
          : scenario === "abyssal" ? live.tryActivateMonsterEffect(required(owner.field[0]), null, "field", owner, { effectId: "abyssal_serpent_delayed_summon_effect" })
          : scenario === "protection" ? live.tryActivateMonsterEffect(required(owner.field[0]), null, "field", owner, { effectId: "rainbow_cosmic_dragon_protect_dragon" })
          : scenario === "mist" ? live.performNormalSummon(owner, 0, "attack", false)
          : scenario.startsWith("roar-") ? live.tryActivateSpell(required(owner.hand[0]), 0, null, { owner })
          : scenario === "mist-bounce-monster" || scenario === "mist-bounce-backrow" ? live.tryActivateMonsterEffect(required(owner.field[0]), null, "field", owner, { effectId: "mist_extreme_dragon_bounce" })
          : scenario === "soft-opt" ? live.tryActivateMonsterEffect(required(owner.field[0]), null, "field", owner, { effectId: "majestic_silver_dragon_position_switch" })
          : scenario === "sanctuary-effect" ? live.tryActivateMonsterEffect(required(opponent.field[0]), null, "field", opponent, { effectId: "majestic_silver_dragon_position_switch" })
          : live.resolveCombat(required(opponent.field[0]), required(owner.field[0]));
        if (scenario === "roar-one" && controller === "human") {
          for (let attempts = 0; attempts < 300 && !live.targetSelection; attempts++) await new Promise<void>(resolve => setTimeout(resolve, 1));
          const session = required(live.targetSelection);
          const requirement = required(session.requirements.find(requirement => requirement.id === "destroy_targets"));
          session.selections[requirement.id] = [required(requirement.candidates[0]).key];
          await live.finishTargetSelection();
        }
        await completeTestSelections(live, Promise.resolve(action));
        if (scenario.startsWith("metal-")) {
          const result = await action;
          assert.ok(result && typeof result === "object" && "success" in result && result.success,
            result && typeof result === "object" && "reason" in result ? String(result.reason) : "Metal summon must complete");
        }
        if (scenario.startsWith("roar-")) {
          const result = await action;
          assert.ok(result && typeof result === "object" && "success" in result && result.success,
            result && typeof result === "object" && "reason" in result ? String(result.reason) : "Roar must resolve successfully");
        }
        if (scenario === "soft-opt") {
          const result = live.tryActivateMonsterEffect(required(owner.field[1]), null, "field", owner, { effectId: "majestic_silver_dragon_position_switch" });
          await completeTestSelections(live, result);
          assert.equal((await result).success, true);
          assert.equal(opponent.field[0]?.position, "attack", "each copy changed the target's position once");
        }
        if (scenario === "luminous") {
          assert.equal(owner.field[0]?.id, 251);
          assert.equal(live.materialDuelStats[seat].effectActivationsByMaterialId.get(251) || 0, 0);
        }
        if (scenario === "crystal") {
          assert.equal(owner.banished.length, 3); assert.equal(owner.field[0]?.id, 264);
          assert.equal(live.materialDuelStats[seat].effectActivationsByMaterialId.get(264) || 0, 0);
        }
        if (scenario === "bull") { assert.equal(owner.graveyard.length, 2); assert.ok(owner.field.some(card => card.id === 259 && card.cannotAttackThisTurn)); assert.equal(opponent.lp, 8000); }
        if (scenario === "peak") { assert.equal(owner.fieldSpell, null); assert.equal(owner.field.length, 1); }
        if (scenario === "abyssal") assert.equal(live.delayedActions.length, 1);
        if (scenario === "rainbow") { assert.equal(owner.banished[0]?.id, 267); assert.ok(owner.graveyard.length > 0); }
        if (scenario === "protection") assert.ok(owner.field.some(card => card.protectionEffects?.length === 2));
        if (scenario === "galaxy") {
          assert.equal(owner.banished[0]?.id, 273);
          await completeTestSelections(live, live.skipToPhase("end"));
          assert.equal(owner.banished[0]?.id, 273, "the opponent's current End Phase is too early");
          await completeTestSelections(live, live.skipToPhase("end"));
          assert.equal(owner.field[0]?.id, 273, "Galaxy returns at the end of the next turn");
          assert.equal(owner.banished.length, 0);
          assert.equal(live.delayedActions.length, 0);
        }
        if (scenario === "armored") assert.ok(owner.field.some(card => card.id === 255));
        if (scenario === "mist") assert.equal(opponent.field[0]?.fieldPresenceSummons.length, 1);
        if (scenario.startsWith("sanctuary-")) {
          assert.equal(owner.field[0]?.id, 254, "the returned Dragon is a resolution candidate");
          assert.equal(owner.field[0]?.level, 4);
          assert.deepEqual(owner.hand.map(card => card.id), [251], "Level 5 is above the returned Dragon's Level");
          assert.equal(owner.graveyard[0]?.id, 268);
        }
        if (scenario.startsWith("roar-")) {
          assert.ok(owner.graveyard.some(card => card.id === 261), "Roar must complete its normal post-Chain cleanup");
          assert.equal(opponent.graveyard.some(card => card.id === 261), scenario === "roar-one");
          assert.equal(opponent.spellTrap.length, scenario === "roar-zero" ? 1 : 0);
        }
        if (scenario === "mist-bounce-monster" || scenario === "mist-bounce-backrow") {
          assert.equal(opponent.hand.length, 1, "the facedown target returned to its owner's hand");
        }
        if (scenario.startsWith("forest-standby-")) {
          const expected = scenario === "forest-standby-self" ? 1000 : 1200;
          assert.equal(owner.lp, 8000 + expected);
          assert.equal(owner.lpGainedThisTurn, expected);
          assert.equal(opponent.lp, 8000);
          assert.equal(live.phase, "main1");
        }
        if (scenario.startsWith("metal-")) {
          const metal = required(owner.field.find(card => card.id === 253));
          assert.equal(metal.fieldPresenceState?.summon_count_Dragon, 1);
          assert.equal(metal.atk, 1700); assert.equal(metal.def, 2100);
        }
        const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: `dragon-${scenario}` }))));
        const commandCount = scenario === "metal-opponent-summon" || scenario === "galaxy" ? 3 :
          scenario === "soft-opt" || scenario === "metal-own-summon" ? 2 : 1;
        assert.equal(replay.commands.length, commandCount, "Resolution must not add external commands");
        if (scenario.startsWith("sanctuary-")) {
          const choices = replay.decisions.filter(decision => decision.kind === "choice" && "selections" in decision.value &&
            "replacement" in decision.value.selections);
          assert.equal(choices.length, 1, "exactly one recorded resolution choice");
          assert.equal(replay.events?.filter(event => event.event === "after_summon").length, 1);
        }
        if (scenario.startsWith("metal-")) {
          assert.equal(replay.events?.filter(event => event.event === "after_summon").length, 2);
        }
        if (scenario.startsWith("roar-")) {
          const choices = replay.decisions.filter(decision => decision.kind === "choice");
          assert.equal(choices.length, scenario === "roar-empty" ? 0 : 1);
          if (scenario !== "roar-empty") {
            const value = required(choices[0]).value;
            assert.ok("selections" in value);
            assert.equal(required(value.selections.destroy_targets).length, scenario === "roar-one" ? 1 : 0);
          }
        }
        setLocale("pt-br");
        const result = await replayCanonicalDuel(replay, { game: unsafeFixture<ReplayDriverGamePort>(playback, "Real Game exposes its own players and cards to the replay driver.") });
        assert.equal(result.ok, true);
        assert.equal(result.finalStateHash, replay.result?.finalStateHash);
        assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
      });
    }
  }
}
