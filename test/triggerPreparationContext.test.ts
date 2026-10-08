import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cleanupTempBoosts } from "../src/core/game/turn/cleanup.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "./helpers/game.js";

function setup(t: TestContext, seat: "player" | "bot", controller: "human" | "ai") {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  game.turn = seat;
  game.turnCounter = 2;
  game.phase = "battle";
  game.battleStep = "battle";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat];
  const opponent = seat === "player" ? game.bot : game.player;
  owner.controllerType = controller;
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showChainResponseModal = async () => null;
  game.ui.showSpecialSummonPositionModal = (_card, choose) => required(choose)("attack");
  t.after(() => game.dispose());
  return { game, owner, opponent };
}

// Both modal and field selections remain manual. Submit only a candidate that
// the real broker exposed, preferring the forbidden card to detect its leakage.
async function completeHumanSelections(
  game: RuntimeGame,
  action: Promise<unknown>,
  preferred: Card,
  candidateLists: Array<Array<unknown>>,
  controller: "human" | "ai",
) {
  let done = false;
  let failure: unknown;
  let humanSelections = 0;
  const completion = action.then(() => { done = true; }, error => { failure = error; done = true; });
  const pending = new Set<Promise<void>>();
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session) {
      assert.equal(controller, "human", "AI choices must not open a human selection session");
      humanSelections++;
      for (const requirement of session.requirements) {
        candidateLists.push(requirement.candidates.map(candidate => candidate.cardRef));
        const chosen = required(requirement.candidates.find(candidate => candidate.cardRef === preferred)
          ?? requirement.candidates[0]);
        session.selections[requirement.id] = [chosen.key];
      }
      const resolution = game.finishTargetSelection();
      pending.add(resolution);
      void resolution.then(() => pending.delete(resolution), error => { failure = error; pending.delete(resolution); });
    }
    if (done && !game.targetSelection && pending.size === 0) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done, "the public action and its trigger must finish");
  assert.equal(game.targetSelection, null);
  assert.equal(pending.size, 0);
  await completion;
  if (failure) throw failure;
  assert.equal(humanSelections > 0, controller === "human", "human targeting requires an explicit selection");
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const battle of ["direct", "attacking", "defending"] as const) {
      test(`Magic Sickle preparation retains ${battle} participant for ${controller} in ${seat}`, async t => {
        const { game, owner, opponent } = setup(t, seat, controller);
        if (battle === "defending") game.turn = seat === "player" ? "bot" : "player";
        const luminarch = new Card(cardDefinition(151), owner.id);
        const sickle = new Card(cardDefinition(156), owner.id);
        const other = new Card({ name: "Battle opponent", cardKind: "monster", atk: 1000, def: 1000 }, opponent.id);
        placeFieldCards(owner.field, luminarch);
        if (battle !== "direct") placeFieldCards(opponent.field, other);
        owner.hand.push(sickle);
        const observations: Array<{ step: string; paid: boolean; atk: number; def: number }> = [];
        const observe = (step: string) => observations.push({
          step, paid: owner.graveyard.includes(sickle), atk: luminarch.atk, def: luminarch.def,
        });
        game.on("card_to_grave", event => { if (event.card === sickle) observe("cost"); });
        game.on("trigger_chain_prepared", event => { if (event.preparedCount > 0) observe("prepared"); });
        game.on("chain_link_resolution", event => {
          if (event.effectId === "luminarch_magic_sickle_damage_boost") observe(event.stage);
        });

        await game.resolveCombat(battle === "defending" ? other : luminarch,
          battle === "direct" ? null : battle === "defending" ? luminarch : other);

        assert.deepEqual(observations, [
          { step: "cost", paid: true, atk: 1600, def: 1200 },
          { step: "prepared", paid: true, atk: 1600, def: 1200 },
          { step: "resolving", paid: true, atk: 1600, def: 1200 },
          { step: "completed", paid: true, atk: 2800, def: 2900 },
        ], "the single cost precedes preparation, link resolution, and the bonus");
        assert.deepEqual([luminarch.atk, luminarch.def], [2800, 2900]);
        assert.equal(owner.lp, 8000);
        assert.equal(opponent.lp, battle === "direct" ? 5200 : 6200);
        assert.deepEqual(owner.graveyard, [sickle]);
        assert.deepEqual(owner.hand, []);
        const nextCopy = new Card(cardDefinition(156), owner.id);
        assert.equal(game.canUseOncePerTurn(nextCopy, owner, required(nextCopy.effects[0])).ok, false);
        cleanupTempBoosts(owner);
        assert.deepEqual([luminarch.atk, luminarch.def], [1600, 1200]);
      });
    }

    for (const id of [404, 511]) {
      for (const defending of [false, true]) {
        test(`${id} preparation retains ${defending ? "defender" : "attacker"} battle context for ${controller} in ${seat}`, async t => {
          const { game, owner, opponent } = setup(t, seat, controller);
          if (defending) game.turn = seat === "player" ? "bot" : "player";
          const source = new Card(cardDefinition(id), owner.id);
          const other = new Card({ name: "Special Summoned Spore target", cardKind: "monster", atk: 1000, def: 1000 }, opponent.id);
          other.lastSummonMethod = "special";
          other.addCounter("spore", 1);
          placeFieldCards(owner.field, source);
          placeFieldCards(opponent.field, other);
          const baseAtk = source.atk;
          const baseDef = source.def;
          const effectId = id === 404
            ? `bloomrot_rot_stag_${defending ? "defense" : "attack"}_spore_boost`
            : `tech_zero_ghost_samurai_${defending ? "defend" : "attack"}_special_summoned_boost`;
          const effect = required(source.effects.find(entry => entry.id === effectId));
          const resolvedStats: number[][] = [];
          game.on("chain_link_resolution", event => {
            if (event.effectId === effectId && event.stage === "completed") resolvedStats.push([source.atk, source.def]);
          });

          await game.resolveCombat(defending ? other : source, defending ? source : other);

          assert.deepEqual(resolvedStats, [[baseAtk + 500, baseDef]]);
          assert.equal(opponent.lp, 8000 - (baseAtk + 500 - 1000));
          assert.equal(owner.lp, 8000);
          assert.deepEqual([source.atk, source.def], [baseAtk, baseDef], "the battle bonus is cleared after combat");
          assert.ok(opponent.graveyard.includes(other));
          assert.ok(owner.field.includes(source));
          if (id === 404) {
            const nextCopy = new Card(cardDefinition(id), owner.id);
            for (const battleEffect of nextCopy.effects.filter(entry => entry.id === "bloomrot_rot_stag_attack_spore_boost"
              || entry.id === "bloomrot_rot_stag_defense_spore_boost")) {
              assert.equal(game.canUseOncePerTurn(nextCopy, owner, battleEffect).ok, false, "both battle effects share hard OPT");
            }
          } else {
            assert.equal(effect.oncePerTurn, undefined);
          }
        });
      }
    }

    test(`Pursuer preparation excludes the destroyed monster for ${controller} in ${seat}`, async t => {
      const { game, owner, opponent } = setup(t, seat, controller);
      const source = new Card(cardDefinition(123), owner.id);
      const destroyed = new Card({ name: "Just destroyed", cardKind: "monster", atk: 2400, def: 2000, level: 4 }, opponent.id);
      const legal = new Card({ name: "Earlier grave monster", cardKind: "monster", atk: 100, def: 100, level: 1 }, opponent.id);
      placeFieldCards(owner.field, source);
      placeFieldCards(opponent.field, destroyed);
      opponent.graveyard.push(legal);
      const candidateLists: Array<Array<unknown>> = [];
      const selectCandidates = game.effectEngine.selectCandidates.bind(game.effectEngine);
      game.effectEngine.selectCandidates = (...args) => {
        const result = selectCandidates(...args);
        if (args[0].id === "arctroth_pursuer_opponent_gy_target") candidateLists.push([...result.candidates]);
        return result;
      };
      await completeHumanSelections(game, game.resolveCombat(source, destroyed), destroyed, candidateLists, controller);
      assert.ok(candidateLists.length > 0);
      for (const candidates of candidateLists) assert.deepEqual(candidates, [legal], "every targeting pass excludes the battle victim");
      assert.deepEqual(opponent.field, [legal]);
      assert.deepEqual(opponent.graveyard, [destroyed]);
      assert.equal(legal.lastSummonMethod, "special");
      assert.equal(source.canMakeSecondAttackThisTurn, true);
      assert.equal(source.extraAttackTargetRestriction, "monster");
      const copy = new Card(cardDefinition(123), owner.id);
      assert.equal(game.canUseOncePerTurn(copy, owner, required(copy.effects[1])).ok, false);
    });

    test(`Luminous preparation excludes both discarded-name copies for ${controller} in ${seat}`, async t => {
      const { game, owner } = setup(t, seat, controller);
      game.phase = "main1";
      const source = new Card(cardDefinition(251), owner.id);
      const discarded = new Card(cardDefinition(252), owner.id);
      const sameName = new Card(cardDefinition(252), owner.id);
      const legal = new Card(cardDefinition(254), owner.id);
      placeFieldCards(owner.field, source);
      owner.graveyard.push(sameName, legal);
      owner.hand.push(discarded);
      const candidateLists: Array<Array<unknown>> = [];
      let aiChoices = 0;
      const select = game.autoSelector.select.bind(game.autoSelector);
      game.autoSelector.select = (contract, context) => {
        const normalized = game.normalizeSelectionContract(contract);
        if (!normalized.ok) return select(contract, context);
        const requirement = normalized.contract.requirements.find(entry => entry.id === "luminous_recover_target");
        if (!requirement) return select(contract, context);
        aiChoices++;
        const candidates = requirement.candidates;
        candidateLists.push(candidates.map(candidate => candidate.cardRef));
        // This is only a deterministic policy over the actual candidate set;
        // it cannot repair targeting by supplying a card the engine excluded.
        const chosen = required(candidates.find(candidate => candidate.cardRef === discarded) ?? candidates[0]);
        return { ok: true, selections: { [requirement.id]: [chosen.key] } };
      };
      await completeHumanSelections(game, Promise.resolve(game.moveCard(discarded, owner, "graveyard", {
        fromZone: "hand", contextLabel: "discard", awaitEvents: true,
      })), discarded, candidateLists, controller);
      assert.ok(candidateLists.length > 0, "the broker presents a recovery choice");
      for (const candidates of candidateLists) assert.deepEqual(candidates, [legal], "name exclusion must run before policy selection");
      assert.equal(aiChoices > 0, controller === "ai", "human recovery never invokes AutoSelector");
      assert.deepEqual(owner.hand, [legal]);
      assert.deepEqual(owner.graveyard, [sameName, discarded]);
      const copy = new Card(cardDefinition(251), owner.id);
      const recovery = required(copy.effects.find(effect => effect.id === "luminous_dragon_discard_recover"));
      assert.equal(game.canUseOncePerTurn(copy, owner, recovery).ok, false);
    });
  }
}
