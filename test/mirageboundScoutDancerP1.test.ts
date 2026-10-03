import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import Player from "../src/core/Player.js";
import MirageboundStrategy from "../src/core/ai/MirageboundStrategy.js";
import type { PlayerId } from "../src/core/contracts/primitives.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";

const dancerSummon = "miragebound_dancer_special_summon";
const scoutSearch = "miragebound_scout_search_spell_trap";
const scoutShift = "miragebound_scout_switch_position";
const passes = () => ({ offers: 1, activations: 0, consecutivePasses: 2, lastActivator: null, chainBuilt: false });

function setup(t: TestContext, seat: PlayerId = "player", controller: "human" | "ai" = "ai") {
  t.mock.method(console, "log", () => {});
  const placements: number[] = [];
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false,
    captureReplay: false, randomSeed: 20261002, chainResponseTimeoutMs: 0,
    getFieldPlacementMode: () => "manual",
    fieldPlacementProvider: async () => { placements.push(4); return { outcome: "chosen", slot: 4 }; } });
  t.after(() => game.dispose());
  game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
  game.player.controllerType = game.bot.controllerType = "ai";
  const owner = game[seat], opponent = game.getOpponent(owner);
  owner.controllerType = controller;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showChainResponseModal = async () => null;
  game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
  const make = (id: number, cardOwner: Player = owner) => new Card(cardDefinition(id), cardOwner.id);
  return { game, owner, opponent, make, placements };
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    test(`Dancer resolves its hand summon once through Chain (${seat}, ${controller})`, async t => {
      const { game, owner, make, placements } = setup(t, seat, controller);
      const scout = make(351), dancer = make(352), second = make(352);
      placeFieldCards(owner.field, scout); owner.hand.push(dancer, second);
      const effect = required(dancer.effects.find(entry => entry.id === dancerSummon));
      let responseWindows = 0;
      game.chainSystem.offerChainResponses = async () => {
        if (game.chainSystem.chainStack.some(link => link.card === dancer && link.effect?.id === dancerSummon)) {
          responseWindows++;
          assert.equal(owner.hand.includes(dancer), true, "summon belongs to resolution");
          assert.equal(game.canUseOncePerTurn(second, owner, effect).ok, false, "HOPT is reserved before responses");
        }
        return passes();
      };
      const action = game.tryActivateMonsterEffect(dancer, null, "hand", owner, { effectId: dancerSummon });
      await completeTestSelections(game, action);
      assert.equal((await action).success, true, (await action).reason ?? undefined);
      assert.equal(responseWindows, 1);
      assert.equal(owner.hand.includes(dancer), false);
      assert.equal(owner.field.includes(dancer), true);
      if (controller === "human") {
        assert.equal(dancer.position, "defense");
        assert.equal(dancer.fieldSlot, 4);
        assert.deepEqual(placements, [4]);
      }
      assert.equal(game.materialDuelStats[seat].effectActivationsByMaterialId.get(352), 1);
      assert.equal((await game.tryActivateMonsterEffect(second, null, "hand", owner,
        { effectId: dancerSummon })).success, false);
      assert.equal(owner.hand.includes(second), true);
      const moved: number[] = [];
      game.on("card_moved", event => {
        if (event.card === scout) { moved.push(dancer.atk); assert.equal(event.toZone, "hand"); }
      });
      const bounce = game.tryActivateMonsterEffect(dancer, { miragebound_dancer_bounce_target: [scout] },
        "field", owner, { effectId: "miragebound_dancer_bounce_buff" });
      await completeTestSelections(game, bounce);
      assert.equal((await bounce).success, true, "the independent bounce effect remains usable");
      assert.deepEqual(moved, [1600], "return resolves before the ATK gain");
      assert.equal(dancer.atk, 2200);
      assert.equal(game.materialDuelStats[seat].effectActivationsByMaterialId.get(352), 2);
    });

    test(`Scout optional search plus ignition unlocks Sovereign without seeded history (${seat}, ${controller})`, async t => {
      const { game, owner, opponent, make } = setup(t, seat, controller);
      const scout = make(351), oasis = make(354), sovereign = make(355), target = make(252, opponent);
      owner.hand.push(scout); owner.deck.push(oasis, make(3), make(3));
      opponent.deck.push(make(3, opponent), make(3, opponent));
      owner.extraDeck.push(sovereign); placeFieldCards(opponent.field, target);
      const activated: string[] = [];
      game.on("effect_activated", event => { if (event.card === scout && event.effectId) activated.push(event.effectId); });
      const summon = game.performNormalSummon(owner, 0, "attack", false);
      await completeTestSelections(game, summon);
      assert.equal(required(await summon).success, true);
      assert.equal(owner.hand.includes(oasis), true);
      assert.equal(game.materialDuelStats[seat].effectActivationsByMaterialId.get(351), 1,
        "the successful trigger must count exactly once");
      assert.equal(game.materialDuelStats[opponent.id].effectActivationsByMaterialId.get(351) ?? 0, 0);
      const ignition = game.tryActivateMonsterEffect(scout, { miragebound_scout_position_target: [target] },
        "field", owner, { effectId: scoutShift });
      await completeTestSelections(game, ignition);
      assert.equal((await ignition).success, true);
      assert.equal(target.position, "defense");
      assert.deepEqual(activated, [scoutSearch, scoutShift]);
      assert.equal(game.materialDuelStats[seat].effectActivationsByMaterialId.get(351), 2);
      assert.deepEqual([...required(game.materialDuelStats[seat].activatedEffectIdsByMaterialId.get(351))].sort(),
        [scoutSearch, scoutShift].sort(), "distinct history stays independent of the numeric count");
      assert.equal((await game.tryAscensionSummon(scout, { player: owner })).success, false,
        "a freshly summoned material still observes Ascension cooldown");
      // Advance real turn lifecycle; do not seed counters or material age.
      game.player.controllerType = game.bot.controllerType = "human";
      await game.endTurn(); await game.endTurn();
      assert.equal(game.turn, seat);
      assert.equal(game.turnCounter, 6);
      owner.controllerType = controller;
      assert.equal(game.checkAscensionRequirements(owner, sovereign, scout).ok, true);
      const ascension = game.tryAscensionSummon(scout, { player: owner });
      await completeTestSelections(game, ascension);
      assert.equal((await ascension).success, true);
      assert.equal(owner.graveyard.includes(scout), true);
      assert.equal(owner.field.includes(sovereign), true);
      assert.equal(game.materialDuelStats[seat].effectActivationsByMaterialId.get(351), 2);
    });
  }

  test(`Dancer cannot verify a face-down Miragebound for its condition (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat);
    const hidden = make(351), dancer = make(352);
    hidden.isFacedown = true; hidden.position = "defense";
    placeFieldCards(owner.field, hidden); owner.hand.push(dancer);
    const effect = required(dancer.effects.find(entry => entry.id === dancerSummon));
    assert.equal(game.effectEngine.canActivateMonsterEffectPreview(dancer, owner, "hand",
      { effectId: dancerSummon }).ok, false);
    assert.equal((await game.tryActivateMonsterEffect(dancer, null, "hand", owner,
      { effectId: dancerSummon })).success, false);
    assert.equal(owner.hand.includes(dancer), true);
    assert.equal(game.canUseOncePerTurn(dancer, owner, effect).ok, true, "an illegal attempt consumes no HOPT");
  });

  for (const negation of ["activation", "effect"] as const) {
    test(`Dancer retains its HOPT after ${negation} negation (${seat})`, async t => {
      const { game, owner, make } = setup(t, seat);
      const dancer = make(352), second = make(352);
      placeFieldCards(owner.field, make(351)); owner.hand.push(dancer, second);
      game.chainSystem.offerChainResponses = async () => {
        const link = game.chainSystem.chainStack.find(entry => entry.card === dancer);
        if (link) { if (negation === "activation") link.activationNegated = true; else link.effectNegated = true; }
        return passes();
      };
      await game.tryActivateMonsterEffect(dancer, null, "hand", owner, { effectId: dancerSummon });
      assert.equal(owner.hand.includes(dancer), true);
      assert.equal(game.canUseOncePerTurn(second, owner,
        required(second.effects.find(effect => effect.id === dancerSummon))).ok, false);
      assert.equal(game.materialDuelStats[seat].effectActivationsByMaterialId.get(352) ?? 0,
        negation === "activation" ? 0 : 1);
    });
  }

  test(`Scout search may be declined without activation or progression (${seat})`, async t => {
    const { game, owner, make } = setup(t, seat, "human");
    const scout = make(351), search = make(354);
    owner.hand.push(scout); owner.deck.push(search);
    let offered = 0, activated = 0;
    game.ui.showConfirmPrompt = async () => {
      offered++; return false;
    };
    game.on("effect_activated", event => { if (event.card === scout) activated++; });
    await game.performNormalSummon(owner, 0, "attack", false);
    assert.equal(offered, 1); assert.equal(activated, 0);
    assert.equal(owner.deck.includes(search), true);
    assert.equal(game.materialDuelStats[seat].effectActivationsByMaterialId.get(351) ?? 0, 0);
    assert.equal(game.materialDuelStats[seat].activatedEffectIdsByMaterialId.has(351), false);
  });

  for (const change of ["activation_negated", "effect_negated", "source_leaves", "search_disappears"] as const) {
    test(`Scout trigger progression preserves completion semantics: ${change} (${seat})`, async t => {
      const { game, owner, make } = setup(t, seat);
      const scout = make(351), search = make(354);
      owner.hand.push(scout); owner.deck.push(search);
      let responseWindows = 0;
      game.chainSystem.offerChainResponses = async () => {
        const link = game.chainSystem.chainStack.find(entry => entry.card === scout && entry.effect?.id === scoutSearch);
        if (link) {
          responseWindows++;
          if (change === "activation_negated") link.activationNegated = true;
          else if (change === "effect_negated") link.effectNegated = true;
          else if (change === "source_leaves") await game.moveCard(scout, owner, "hand", { fromZone: "field" });
          else await game.moveCard(search, owner, "graveyard", { fromZone: "deck" });
        }
        return passes();
      };
      await game.performNormalSummon(owner, 0, "attack", false);
      assert.equal(responseWindows, 1);
      assert.equal(owner.hand.includes(search), change === "source_leaves",
        "a monster trigger may resolve from its activation snapshot after its source leaves");
      assert.equal(game.materialDuelStats[seat].effectActivationsByMaterialId.get(351) ?? 0,
        change === "effect_negated" || change === "source_leaves" ? 1 : 0);
      assert.equal(game.materialDuelStats[seat].activatedEffectIdsByMaterialId.get(351)?.has(scoutSearch) ?? false,
        change !== "activation_negated", "the valid activation history is separate from success progression");
    });
  }
}

for (const hidden of [false, true]) {
  test(`Dancer planning simulation agrees with public runtime (hidden condition=${hidden})`, async t => {
    const { game, owner, make } = setup(t);
    const dancer = make(352), scout = make(351);
    scout.isFacedown = hidden;
    placeFieldCards(owner.field, scout); owner.hand.push(dancer);
    const simDancer = simulationCard(new Card(cardDefinition(352), "bot"));
    const simScout = simulationCard(new Card(cardDefinition(351), "bot"));
    simScout.isFacedown = hidden;
    const state = simulationState({ _isPerspectiveState: true, turn: "bot", phase: "main1", turnCounter: 4,
      bot: { hand: [simDancer], field: [simScout] } });
    const strategy = new MirageboundStrategy(new Player("bot", "Miragebound P1"));
    strategy.simulateMainPhaseAction(state, { type: "handIgnition", index: 0, cardId: 352, effectId: dancerSummon });
    const result = await game.tryActivateMonsterEffect(dancer, null, "hand", owner, { effectId: dancerSummon });
    assert.equal(result.success, !hidden);
    assert.equal(owner.field.includes(dancer), !hidden);
    assert.equal(state.bot.field.some(card => card.id === 352), !hidden);
    assert.equal(state.bot.hand.some(card => card.id === 352), hidden);
  });
}
