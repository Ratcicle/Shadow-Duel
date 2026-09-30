import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "./helpers/game.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { cleanupTempBoosts } from "../src/core/game/turn/cleanup.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { simulationCard, simulationState, placeSimulationCards } from "./helpers/simulation.js";
import { createGameTreeCopy } from "../src/core/ai/common/gameTreeSimulation.js";
import { applyLuminarchSimulatedBattleRewards } from "../src/core/ai/luminarch/simulation.js";
import { fingerprintPlanningState } from "../src/core/ai/common/stateFingerprint.js";
import { moveCardToZone } from "../src/core/ai/common/zones.js";
import { replayCanonicalDuel } from "../src/core/game/replay/driver.js";
import { validateCanonicalReplay } from "../src/core/game/replay/canonical.js";
import type { ReplayDriverGamePort } from "../src/core/contracts/replay.js";

function setup(t: TestContext) {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  game.turn = "player";
  game.turnCounter = 2;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  game.ui.showChainResponseModal = async () => null;
  t.after(() => game.dispose());
  return game;
}

for (const method of ["normal", "special"] as const) {
  for (const accept of [false, true]) {
    test(`Valiant ${method}: human ${accept ? "accepts and chooses" : "declines"} search`, async t => {
      const game = setup(t);
      game.player.controllerType = "human";
      const valiant = new Card(cardDefinition(151), "player");
      const chosen = new Card(cardDefinition(156), "player");
      const other = new Card(cardDefinition(153), "player");
      const invalid = [158, 163, 101].map(id => new Card(cardDefinition(id), "player"));
      placeFieldCards(game.player.field, valiant);
      game.player.deck.push(chosen, other, ...invalid);
      let prompts = 0;
      let selections = 0;
      game.ui.showConfirmPrompt = async () => { prompts++; return accept; };
      game.ui.showTargetSelection = (contract, confirm) => {
        selections++;
        const requirement = required(required(required(contract).requirements)[0]);
        assert.deepEqual(new Set(requirement.candidates.map(entry => entry.cardRef)), new Set([chosen, other]));
        const candidate = required(requirement.candidates.find(entry => entry.cardRef === chosen));
        setImmediate(() => required(confirm)({ [requirement.id]: [candidate.key] }));
        return { close() {} };
      };
      await game.emit("after_summon", { card: valiant, player: game.player, opponent: game.bot, method });
      assert.equal(prompts, 1);
      assert.equal(selections, accept ? 1 : 0);
      assert.deepEqual(game.player.hand, accept ? [chosen] : []);
    });
  }
}

for (const seat of ["player", "bot"] as const) {
  for (const direct of [false, true]) {
    test(`Magic Sickle boosts ${seat} in ${direct ? "direct attack" : "monster combat"} once and pays first`, async t => {
      const game = setup(t);
      const owner = game[seat];
      const opponent = seat === "player" ? game.bot : game.player;
      game.turn = seat;
      game.phase = "battle";
      game.battleStep = "battle";
      const attacker = new Card(cardDefinition(151), owner.id);
      const sickle = new Card(cardDefinition(156), owner.id);
      const second = new Card(cardDefinition(156), owner.id);
      const defender = new Card({ name: "Target", cardKind: "monster", atk: 1000, def: 1000 }, opponent.id);
      placeFieldCards(owner.field, attacker);
      if (!direct) placeFieldCards(opponent.field, defender);
      owner.hand.push(sickle);
      let resolutions = 0;
      game.on("chain_link_resolution", event => {
        if (event.effectId !== "luminarch_magic_sickle_damage_boost" || event.stage !== "completed") return;
        resolutions++;
        assert.ok(owner.graveyard.includes(sickle));
      });
      game.on("card_to_grave", event => {
        if (event.card === sickle) assert.equal(attacker.atk, 1600, "cost precedes the buff");
      });
      await game.resolveCombat(attacker, direct ? null : defender);
      assert.equal(attacker.atk, 2800);
      assert.equal(attacker.def, 2900);
      assert.equal(opponent.lp, direct ? 5200 : 6200);
      assert.equal(resolutions, 1);
      owner.hand.push(second);
      assert.equal(game.canUseOncePerTurn(second, owner, required(second.effects[0])).ok, false);
      cleanupTempBoosts(owner);
      assert.equal(attacker.atk, 1600);
      assert.equal(attacker.def, 1200);
    });
  }
}

test("Radiant Lancer loses only its accumulated face-up buff when set", async t => {
  const game = setup(t);
  const lancer = new Card(cardDefinition(158), "player");
  placeFieldCards(game.player.field, lancer);
  const base = lancer.atk;
  game.phase = "battle";
  game.battleStep = "battle";
  for (let i = 0; i < 2; i++) {
    lancer.hasAttacked = false;
    lancer.attacksUsedThisTurn = 0;
    const victim = new Card({ name: "Victim", cardKind: "monster", atk: 100, def: 100 }, "bot");
    placeFieldCards(game.bot.field, victim);
    await game.resolveCombat(lancer, victim);
  }
  assert.equal(lancer.atk, base + 200);
  const ctx = { player: game.player, opponent: game.bot, source: lancer };
  await game.effectEngine.applyActions([{ type: "permanent_buff_named", atkBoost: 300, sourceName: "Other" }], ctx, {});
  await game.effectEngine.applyActions([{ type: "switch_position", targetRef: "self" }], ctx, {});
  assert.equal(lancer.atk, base + 500);
  game.on("position_change", event => {
    if (event.wasSetFacedown) assert.equal(lancer.atk, base + 300);
  });
  await game.effectEngine.applyActions([{ type: "set_facedown_defense", targetRef: "self" }], ctx, {});
  assert.equal(lancer.atk, base + 300);
  lancer.isFacedown = false;
  assert.equal(lancer.atk, base + 300);
  assert.deepEqual(lancer.permanentBuffsBySource, { Other: { atk: 300 } });
});

for (const destination of ["hand", "graveyard", "banished"] as const) {
  test(`Radiant Lancer loses its buff on leaving for ${destination}`, async t => {
    const game = setup(t);
    const lancer = new Card(cardDefinition(158), "player");
    placeFieldCards(game.player.field, lancer);
    const base = lancer.atk;
    await game.effectEngine.applyActions(required(required(lancer.effects[0]).actions), { player: game.player, opponent: game.bot, source: lancer }, {});
    assert.equal(lancer.atk, base + 100);
    await game.moveCard(lancer, game.player, destination, { fromZone: "field", awaitEvents: true });
    assert.equal(lancer.atk, base);
  });
}

test("Holy Ascension adds only 800 ATK in runtime and simulation", async t => {
  const game = setup(t);
  const target = new Card(cardDefinition(151), "player");
  const spell = new Card(cardDefinition(163), "player");
  placeFieldCards(game.player.field, target);
  game.player.hand.push(spell);
  assert.equal((await game.tryActivateSpell(spell, 0, null, { owner: game.player })).success, true);
  assert.deepEqual([target.atk, target.def, game.player.lp], [2400, 1200, 7000]);
  cleanupTempBoosts(game.player);
  assert.deepEqual([target.atk, target.def], [1600, 1200]);
  const simulated = simulationCard({ ...cardDefinition(151), instanceId: 15101 });
  const state = simulationState();
  placeSimulationCards(state.bot.field, simulated);
  applySimulatedActions({ state, actions: required(spell.effects[0]).actions, selections: { holy_ascension_target: [simulated] } });
  assert.deepEqual([simulated.atk, simulated.def], [2400, 1200]);
});

for (const id of [161, 168]) {
  test(`${id}: effects use separate per-copy limits and reset next turn`, t => {
    const game = setup(t);
    const a = new Card(cardDefinition(id), "player");
    const b = new Card(cardDefinition(id), "player");
    for (const effect of a.effects) {
      assert.equal(game.canUseOncePerTurn(a, game.player, effect).ok, true);
      game.markOncePerTurnUsed(a, game.player, effect);
      assert.equal(game.canUseOncePerTurn(a, game.player, effect).ok, false);
      assert.equal(game.canUseOncePerTurn(b, game.player, effect).ok, true);
    }
    game.turnCounter++;
    for (const effect of a.effects) assert.equal(game.canUseOncePerTurn(a, game.player, effect).ok, true);
  });
}

test("Pure Knight search remains spent after leaving and returning, discount still works twice", async t => {
  const game = setup(t);
  const knight = new Card(cardDefinition(173), "player");
  placeFieldCards(game.player.field, knight);
  const search = required(knight.effects[0]);
  game.player.deck.push(new Card(cardDefinition(162), "player"), new Card(cardDefinition(162), "player"));
  await game.emit("after_summon", { card: knight, player: game.player, opponent: game.bot, method: "fusion", fromZone: "extraDeck" });
  assert.equal(game.player.hand.length, 1);
  await game.moveCard(knight, game.player, "graveyard", { fromZone: "field", awaitEvents: true });
  await game.moveCard(knight, game.player, "field", { fromZone: "graveyard", summonOrigin: "effect_resolution", summonMethodOverride: "fusion", summonProcedure: "card_effect", awaitEvents: true });
  assert.ok(game.player.field.includes(knight));
  knight.isFacedown = false;
  assert.equal(game.canUseOncePerTurn(knight, game.player, search).ok, false);
  assert.equal(game.player.hand.length, 1, "another Fusion Summon must not search again");
  const spell = new Card(cardDefinition(163), "player");
  for (const expected of [8000, 8000, 7000]) {
    await game.effectEngine.applyActions([{ type: "pay_lp", amount: 1000 }], { player: game.player, opponent: game.bot, source: spell }, {});
    assert.equal(game.player.lp, expected);
  }
  game.turnCounter++;
  assert.equal(game.canUseOncePerTurn(knight, game.player, search).ok, true);
  await game.emit("after_summon", { card: knight, player: game.player, opponent: game.bot, method: "fusion", fromZone: "extraDeck" });
  assert.equal(game.player.hand.length, 2);
});

test("position simulation expires face-up buffs without mutating its input", async t => {
  const game = setup(t);
  const lancer = new Card(cardDefinition(158), "player");
  placeFieldCards(game.player.field, lancer);
  const base = lancer.atk;
  await game.effectEngine.applyActions(required(required(lancer.effects[0]).actions), { player: game.player, opponent: game.bot, source: lancer }, {});
  const input = simulationState({ bot: { field: [simulationCard({ ...cardDefinition(158), atk: lancer.atk, permanentBuffsBySource: required(lancer.permanentBuffsBySource), instanceId: lancer.instanceId, fieldSlot: 0 })] } });
  const { state } = createGameTreeCopy(input);
  const copy = required(state.bot.field[0]);
  applySimulatedActions({ state, actions: [{ type: "set_facedown_defense", targetRef: "victim" }], selections: { victim: [copy] } });
  assert.equal(copy.atk, base);
  assert.equal(required(input.bot.field[0]).atk, base + 100);
});

test("Lancer simulated victories each grant 100 ATK and expire on setting", () => {
  const lancer = simulationCard({ ...cardDefinition(158), instanceId: 15801 });
  const state = simulationState({ bot: { field: [lancer] } });
  for (const expected of [2700, 2800]) {
    applyLuminarchSimulatedBattleRewards({ state, battlePlan: { attackerCard: lancer }, summary: {
      attackerName: required(lancer.name), destroyedCards: [{ owner: "opponent", cardKind: "monster" }],
    } });
    assert.equal(lancer.atk, expected);
  }
  const fingerprint = fingerprintPlanningState(state);
  const buff = required(lancer.permanentBuffsBySource?.[required(lancer.name)]);
  delete buff.duration;
  assert.notEqual(fingerprintPlanningState(state), fingerprint);
  buff.duration = "while_faceup";
  applySimulatedActions({ state, actions: [{ type: "set_facedown_defense", targetRef: "target" }], selections: { target: [lancer] } });
  assert.equal(lancer.atk, 2600);
});

for (const zone of ["hand", "graveyard", "banished"] as const) {
  test(`Lancer simulation expires gains on departure to ${zone} and does not restore them`, () => {
    const lancer = simulationCard({ ...cardDefinition(158), instanceId: 15801 });
    const state = simulationState({ bot: { field: [lancer] } });
    applyLuminarchSimulatedBattleRewards({ state, battlePlan: { attackerCard: lancer }, summary: {
      attackerName: required(lancer.name), destroyedCards: [{ owner: "opponent", cardKind: "monster" }],
    } });
    assert.equal(lancer.atk, 2700);
    assert.equal(moveCardToZone(state.bot, lancer, zone), true);
    assert.equal(lancer.atk, 2600);
    assert.equal(moveCardToZone(state.bot, lancer, "field"), true);
    assert.equal(lancer.atk, 2600);
    assert.deepEqual(lancer.permanentBuffsBySource, {});
  });
}

for (const eligible of [false, true]) {
  test(`Magic Sickle: human declines with ${eligible ? "valid" : "no valid"} participant and pays nothing`, async t => {
    const game = setup(t);
    game.phase = "battle";
    game.battleStep = "battle";
    game.player.controllerType = "human";
    const attacker = new Card(cardDefinition(eligible ? 151 : 101), "player");
    const sickle = new Card(cardDefinition(156), "player");
    placeFieldCards(game.player.field, attacker);
    game.player.hand.push(sickle);
    let offers = 0;
    game.ui.showConfirmPrompt = async () => { offers++; return false; };
    await game.resolveCombat(attacker, null);
    assert.equal(offers, eligible ? 1 : 0);
    assert.deepEqual(game.player.hand, [sickle]);
    assert.equal(game.player.graveyard.length, 0);
    assert.equal(attacker.atk, eligible ? 1600 : cardDefinition(101).atk);
    assert.equal(game.canUseOncePerTurn(sickle, game.player, required(sickle.effects[0])).ok, true);
  });
}

test("two Convocations independently prevent destruction", async t => {
  const game = setup(t);
  const first = new Card(cardDefinition(161), "player");
  const second = new Card(cardDefinition(161), "player");
  const target = new Card(cardDefinition(151), "player");
  placeFieldCards(game.player.spellTrap, first, second);
  placeFieldCards(game.player.field, target);
  for (let attempt = 0; attempt < 3; attempt++) {
    await game.destroyCard(target, { cause: "effect" });
    assert.equal(game.player.field.includes(target), attempt < 2);
  }
});

test("both Halberds summon through the real trigger flow and cannot attack", async t => {
  const game = setup(t);
  const source = new Card(cardDefinition(151), "player");
  const copies = [new Card(cardDefinition(168), "player"), new Card(cardDefinition(168), "player")];
  placeFieldCards(game.player.field, source);
  game.player.hand.push(...copies);
  await game.emit("after_summon", { card: source, player: game.player, opponent: game.bot, method: "special", fromZone: "hand" });
  for (const card of copies) {
    assert.ok(game.player.field.includes(card));
    assert.equal(card.cannotAttackThisTurn, true);
    assert.equal(game.canUseOncePerTurn(card, game.player, required(card.effects[0])).ok, false);
  }
});

for (const scenario of ["valiant", "sickle"] as const) {
  for (const accept of [false, true]) {
    test(`canonical replay preserves human ${scenario} ${accept ? "acceptance" : "refusal"}`, async t => {
      const live = createRuntimeGame({ laboratoryMode: true, captureReplay: true, randomSeed: 151156 });
      const playback = createRuntimeGame({ laboratoryMode: true, captureReplay: false, replayMode: "playback" });
      t.after(() => { live.dispose(); playback.dispose(); });
      const install = (game: RuntimeGame) => {
        const start = game.startWithDecks.bind(game);
        game.startWithDecks = async options => {
          await start(options);
          game.turn = "player";
          game.turnCounter = 2;
          game.phase = scenario === "sickle" ? "battle" : "main1";
          game.battleStep = "battle";
          game.disablePresentationDelays = true;
          game.waitForBoardPresentation = async () => {};
          game.waitForPresentationDelay = async () => {};
          game.waitForAiPresentationStep = async () => {};
          game.player.controllerType = "human";
          game.bot.controllerType = "ai";
          const owner = game.player;
          owner.deck.push(...owner.hand.splice(0));
          const take = (id: number) => {
            const card = required(owner.deck.find(card => card.id === id));
            owner.deck.splice(owner.deck.indexOf(card), 1);
            return card;
          };
          if (scenario === "sickle") {
            placeFieldCards(owner.field, take(151));
            owner.hand.push(take(156));
          } else owner.hand.push(take(151));
        };
        game.ui.showChainResponseModal = async () => null;
      };
      install(live);
      install(playback);
      let choices = 0;
      live.ui.showConfirmPrompt = async () => accept;
      live.ui.showTargetSelection = (contract, confirm) => {
        choices++;
        const requirement = required(required(required(contract).requirements)[0]);
        const candidate = required(requirement.candidates.find(entry => entry.cardRef?.id === 153));
        setImmediate(() => required(confirm)({ [requirement.id]: [candidate.key] }));
        return { close() {} };
      };
      playback.ui.showConfirmPrompt = async () => assert.fail("Replay must consume the recorded confirmation");
      playback.ui.showTargetSelection = () => assert.fail("Replay must consume the recorded selection");
      await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
        startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
        playerDeck: [151, 156, 153, ...Array<number>(10).fill(3)], botDeck: Array<number>(13).fill(3),
        playerExtraDeck: [], botExtraDeck: [] });
      if (scenario === "sickle") {
        await live.resolveCombat(required(live.player.field[0]), null);
        assert.equal(live.bot.lp, accept ? 5200 : 6400);
      } else {
        await live.performNormalSummon(live.player, 0, "attack", false, []);
        assert.equal(live.player.hand.some(card => card.id === 153), accept);
        assert.equal(choices, accept ? 1 : 0);
      }
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "luminarch-design" }))));
      assert.equal(replay.commands.length, 1);
      const confirmation = required(replay.decisions.find(decision => decision.kind === "segoc_order"));
      assert.ok(confirmation.value && "orderedCandidateKeys" in confirmation.value);
      assert.equal(confirmation.value.orderedCandidateKeys?.length, accept ? 1 : 0);
      const result = await replayCanonicalDuel(replay, {
        game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game supplies the canonical playback methods."),
      });
      assert.equal(result.ok, true);
      assert.equal(result.finalStateHash, replay.result?.finalStateHash);
      assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    });
  }
}
