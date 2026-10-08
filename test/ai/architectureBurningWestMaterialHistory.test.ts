import assert from "node:assert/strict";
import test from "node:test";
import BurningWestStrategy from "../../src/core/ai/BurningWestStrategy.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { canUseSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { isFullChainHost, type ChainSelectionMap } from "../../src/core/contracts/chainRuntime.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";

for (const seat of ["bot", "player"] as const) {
  test(`BurningWest paid Gunslinger activation retains distinct history after effect negation (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false });
    t.after(() => game.dispose("architecture_burning_west_material_history"));
    game.turn = seat; game.phase = "battle"; game.turnCounter = 4; game.disablePresentationDelays = true;
    const owner = game[seat], opponent = game[seat === "bot" ? "player" : "bot"];
    owner.controllerType = opponent.controllerType = "ai";
    const source = required(game.createCardForOwner(451, owner));
    const cost = required(game.createCardForOwner(458, owner));
    const opposingHand = required(game.createCardForOwner(1, opponent));
    const destroyed = required(game.createCardForOwner(503, opponent));
    source.position = "attack"; source.isFacedown = false;
    placeFieldCards(owner.field, source); owner.hand.push(cost);
    opponent.hand.push(opposingHand); opponent.graveyard.push(destroyed);
    const effect = required(source.effects.find(effect => effect.id === "burning_west_gunslinger_battle_discard"));
    const { state } = createGameTreeCopy(game, owner);
    const simSource = required(state.bot.field[0]), simDestroyed = required(state.player.graveyard[0]);
    const chain = game.chainSystem;
    assert.ok(isFullChainHost(chain));
    const link = required(await chain.addToChain(chain.createPreparedActivation({ card: source, controller: owner, effect,
      activationZone: "field", committed: true, costsPaid: true,
      targetSelections: unsafeFixture<ChainSelectionMap>({ burning_west_gunslinger_cost: [cost] },
        "Runtime Chain target map carries the selected physical cost behind its nominal public projection."),
      context: { attacker: source, destroyed, destroyedOwner: opponent, battleDestroyer: source, battleDestroyers: [source] } })));
    assert.ok(link && typeof link === "object");
    await game.effectEngine.applyActions(effect.activationCosts || [], { source, player: owner, opponent },
      { burning_west_gunslinger_cost: [cost] });
    source.effectsNegated = true;
    assert.equal(required(await chain.resolveChainLink(link)).effectNegated, true);
    const strategy = new BurningWestStrategy(state.bot);
    const apply = () => strategy.applySimulatedBattleRewards({ state, bot: state.bot, opponent: state.player,
      options: { onSimulatedEvent: (event: string, payload: object) => {
        const eventCard: unknown = Reflect.get(payload, "card");
        if (event === "card_moved" && eventCard && typeof eventCard === "object" &&
            Reflect.get(eventCard, "instanceId") === cost.instanceId) simSource.effectsNegated = true;
      } }, battlePlan: { attackerCard: simSource }, summary: { damage: 0, destroyedCards: [
        { ...simDestroyed, owner: "opponent", destroyedBy: "battle", card: simDestroyed }] } });
    apply();
    assert.deepEqual(state.bot.hand.map(card => card.instanceId), owner.hand.map(card => card.instanceId));
    assert.deepEqual(state.player.hand.map(card => card.instanceId), [opposingHand.instanceId]);
    assert.equal(state.bot.graveyard.filter(card => card.instanceId === cost.instanceId).length, 1);
    assert.equal(game.materialDuelStats[seat].effectActivationsByMaterialId.get(451) || 0, 0);
    assert.equal(state.materialDuelStats?.[seat].effectActivationsByMaterialId.get(451) || 0, 0);
    const runtimeHistory = [...(game.materialDuelStats[seat].activatedEffectIdsByMaterialId.get(451) || [])];
    assert.deepEqual(runtimeHistory, [effect.id]);
    assert.deepEqual([...(state.materialDuelStats?.[seat].activatedEffectIdsByMaterialId.get(451) || [])], runtimeHistory);
    assert.equal(canUseSimulatedEffectUsage(state, effect, simSource, seat, true), false);
    const facts = () => ({ ownHand: state.bot.hand.map(card => card.instanceId),
      ownGraveyard: state.bot.graveyard.map(card => card.instanceId), opponentHand: state.player.hand.map(card => card.instanceId),
      atk: simSource.atk, count: state.materialDuelStats?.[seat].effectActivationsByMaterialId.get(451) || 0,
      history: [...(state.materialDuelStats?.[seat].activatedEffectIdsByMaterialId.get(451) || [])] });
    const after = facts();
    apply();
    assert.deepEqual(facts(), after);
    assert.deepEqual([...(state.materialDuelStats?.[seat].activatedEffectIdsByMaterialId.get(451) || [])], [effect.id]);
  });
}
