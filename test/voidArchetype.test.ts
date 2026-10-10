import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import ChainSystem from "../src/core/ChainSystem.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import VoidStrategy from "../src/core/ai/VoidStrategy.js";
import { createGameTreeCopy } from "../src/core/ai/common/gameTreeSimulation.js";
import { fingerprintPlanningState } from "../src/core/ai/common/stateFingerprint.js";
import { validateHandIgnitionCandidate } from "../src/core/ai/common/actionValidation.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { canUseSimulatedEffectUsage, markSimulatedEffectUsage } from "../src/core/ai/common/simStateUtils.js";
import { cleanupTempBoosts } from "../src/core/game/turn/cleanup.js";
import { cleanupSimulatedEndTurn } from "../src/core/ai/common/simulatedActions/lifecycle.js";
import { moveCardToZone } from "../src/core/ai/common/zones.js";
import type { ActionOf } from "../src/core/contracts/actions.js";
import type { GamePlayer } from "../src/core/contracts/player.js";
import type { BattleDestroyEventPayload } from "../src/core/contracts/events.js";
import type { ReplayDecisionInput } from "../src/core/contracts/decisions.js";
import { cardDatabaseById, required, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function createGame(t: TestContext, disableChains = false) {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,
    disableChains,
    chainResponseTimeoutMs: 1,
  });
  game.turn = game.player.id;
  game.turnCounter = 2;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose("void_archetype_test_complete"));
  return game;
}

function makeCard(id: number, owner: GamePlayer) {
  const card = new Card(required(cardDatabaseById.get(id)), owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  card.isFacedown = false;
  card.position = "attack";
  return card;
}

const passedResponses = { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 } as const;

async function sealingScenario(t: TestContext, boosts: number, disableChains = false) {
  const game = createGame(t, disableChains);
  const aberration = makeCard(227, game.player);
  const seal = makeCard(216, game.player);
  placeFieldCards(game.player.field, aberration);
  game.player.hand.push(seal);
  const context = { player: game.player, opponent: game.bot, source: aberration };
  for (let index = 0; index < boosts; index++) {
    if (disableChains) {
      // The no-Chain harness does not dispatch triggers; seed the bonus with the actual 227 action.
      const buff = required(aberration.effects.find(e => e.id === "void_aberration_void_to_grave_buff"));
      await game.effectEngine.applyActions(required(buff.actions), context, {});
      // The buff emits its replay event asynchronously; finish it before activating the Spell.
      for (let attempt = 0; attempt < 100 && game.eventResolutionDepth > 0; attempt++) {
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(game.eventResolutionDepth, 0);
    } else {
      const sent = makeCard(203, game.player); sent.effects = [];
      game.player.hand.push(sent);
      await game.moveCard(sent, game.player, "graveyard", { fromZone: "hand", awaitCardToGraveEvent: true });
      await game.flushPendingTriggerOccurrences();
    }
  }
  assert.deepEqual([aberration.atk, aberration.def], [2400 + boosts * 100, 1900 + boosts * 100]);
  const effect = required(seal.effects[0]);
  const zero = required(effect.actions?.find((action): action is ActionOf<"set_stats_to_zero_and_negate"> => action.type === "set_stats_to_zero_and_negate"));
  const activate = () => game.tryActivateSpell(seal, 0, { void_monster_target: [aberration] }, { owner: game.player });
  const clone = () => {
    const state = createGameTreeCopy(game, game.player).state;
    delete state._gameRef;
    return { state, card: required(state.bot.field.find(c => c.instanceId === aberration.instanceId)) };
  };
  return { game, aberration, seal, zero, activate, clone, context };
}

for (const disableChains of [false, true]) {
  for (const boosts of [0, 1, 3]) {
    test(`Lote6 216/227 restaura somente atributos vigentes (${boosts} bonus, sem Chain: ${disableChains})`, async t => {
      const { game, aberration, zero, activate, clone } = await sealingScenario(t, boosts, disableChains);
      const simulated = clone(); const sibling = clone();
      applySimulatedActions({ state: simulated.state, actions: [zero], selections: { void_monster_target: [simulated.card] } });
      const activation = await activate();
      assert.equal(activation.success, true, activation.reason ?? undefined);
      assert.deepEqual([aberration.atk, aberration.def], [0, 0]);
      assert.equal(aberration.originalAtk == null, true);
      assert.equal(aberration.originalDef == null, true);
      assert.equal(aberration.effectsNegated, true);
      assert.equal(game.player.additionalNormalSummons, 1);
      assert.deepEqual([simulated.card.atk, simulated.card.def], [0, 0]);
      assert.equal(simulated.card.effectsNegated, true);
      assert.deepEqual([sibling.card.atk, sibling.card.def], [2400 + boosts * 100, 1900 + boosts * 100]);
      if (!disableChains) {
        const sent = makeCard(203, game.player); sent.effects = [];
        game.player.hand.push(sent);
        await game.moveCard(sent, game.player, "graveyard", { fromZone: "hand", awaitCardToGraveEvent: true });
        await game.flushPendingTriggerOccurrences();
        assert.deepEqual([aberration.atk, aberration.def], [0, 0], "Negated Aberration cannot gain its bonus");
      }
      // Exercise the real end-phase cleanup; suppress only the next turn's draw and bot automation.
      t.mock.method(game, "startTurn", async () => {});
      await game.endTurn();
      cleanupSimulatedEndTurn(simulated.state);
      assert.deepEqual([aberration.atk, aberration.def], [2400, 1900]);
      assert.deepEqual([simulated.card.atk, simulated.card.def], [2400, 1900]);
      assert.equal(aberration.effectsNegated, false);
      assert.equal(simulated.card.effectsNegated, false);
      await game.endTurn();
      cleanupSimulatedEndTurn(simulated.state);
      assert.deepEqual([aberration.atk, aberration.def], [2400, 1900]);
      assert.deepEqual([simulated.card.atk, simulated.card.def], [2400, 1900]);
    });
  }

  for (const destination of ["graveyard", "hand", "banished"] as const) {
    test(`Lote6 227 perde bonus ao sair para ${destination} e nao o recupera na Invocacao (sem Chain: ${disableChains})`, async t => {
      const { game, aberration, zero, activate, clone, context } = await sealingScenario(t, 2, disableChains);
      const simulated = clone();
      applySimulatedActions({ state: simulated.state, actions: [zero], selections: { void_monster_target: [simulated.card] } });
      const activation = await activate();
      assert.equal(activation.success, true, activation.reason ?? undefined);
      await game.moveCard(aberration, game.player, destination, { fromZone: "field" });
      moveCardToZone(simulated.state.bot, simulated.card, destination, simulated.state.bot, { state: simulated.state });
      // Fusion monsters requested to hand go to the Extra Deck; preserve that rule.
      const actualZone = destination === "hand" ? "extraDeck" : destination;
      assert.ok(game.player[actualZone].includes(aberration));
      assert.deepEqual([aberration.atk, aberration.def], [2400, 1900]);
      assert.deepEqual([simulated.card.atk, simulated.card.def], [2400, 1900]);
      await game.moveCard(aberration, game.player, "field", { fromZone: actualZone, summonOrigin: "effect_resolution" });
      assert.ok(game.player.field.includes(aberration));
      await game.flushPendingTriggerOccurrences();
      assert.deepEqual([aberration.atk, aberration.def], [2400, 1900]);
      cleanupTempBoosts(context.player);
      assert.deepEqual([aberration.atk, aberration.def], [2400, 1900]);
    });
  }
}

for (const settings of [
  { label: "defaults", fields: {}, zeroAtk: true, zeroDef: true, negated: true, negatedAfterTurn: true },
  { label: "atk", fields: { setDefToZero: false, negateEffects: false }, zeroAtk: true, zeroDef: false, negated: false, negatedAfterTurn: false },
  { label: "def", fields: { setAtkToZero: false, negateEffects: false }, zeroAtk: false, zeroDef: true, negated: false, negatedAfterTurn: false },
  { label: "faceup_negation", fields: { negateEffectsDuration: "while_faceup" as const }, zeroAtk: true, zeroDef: true, negated: true, negatedAfterTurn: true },
]) {
  test(`Lote6 modificacao temporaria preserva ajustes anteriores e reaplicacao (${settings.label})`, async t => {
    const { game, aberration, clone, context } = await sealingScenario(t, 2);
    await game.effectEngine.applyActions([
      { type: "buff_stats_temp", targetRef: "self", atkBoost: 300, defBoost: 200, permanent: true },
      { type: "modify_stats_temp", targetRef: "affected", atkFactor: 0.5, defFactor: 0.5 },
    ], context, { affected: [aberration] });
    const before = [aberration.atk, aberration.def];
    const simulated = clone();
    const zero: ActionOf<"set_stats_to_zero_and_negate"> = { type: "set_stats_to_zero_and_negate", targetRef: "affected", ...settings.fields };
    const expected = [settings.zeroAtk ? 0 : before[0], settings.zeroDef ? 0 : before[1]];
    for (let repeat = 0; repeat < 2; repeat++) {
      await game.effectEngine.applyActions([zero], context, { affected: [aberration] });
      applySimulatedActions({ state: simulated.state, actions: [zero], selections: { affected: [simulated.card] } });
      assert.deepEqual([aberration.atk, aberration.def], expected);
      assert.deepEqual([simulated.card.atk, simulated.card.def], expected);
      assert.equal(aberration.effectsNegated, settings.negated);
      assert.equal(simulated.card.effectsNegated, settings.negated);
    }
    cleanupTempBoosts(game.player); cleanupSimulatedEndTurn(simulated.state);
    assert.deepEqual([aberration.atk, aberration.def], [2700, 2100]);
    assert.deepEqual([simulated.card.atk, simulated.card.def], [2700, 2100]);
    assert.equal(aberration.effectsNegated, settings.negatedAfterTurn);
    assert.equal(simulated.card.effectsNegated, settings.negatedAfterTurn);
  });
}

for (const removeAura of [false, true]) {
  test(`Lote6 restauracao considera somente aura ainda ativa (removida: ${removeAura})`, async t => {
    const { game, aberration, activate, clone, zero } = await sealingScenario(t, 1);
    const aura = new Card({ ...required(cardDatabaseById.get(217)), effects: [{
      id: "void_stat_test_aura", timing: "passive", requireZone: "fieldSpell", passive: {
        type: "field_archetype_aura_buff", archetype: "Void", targetOwners: ["self"], amount: 300, stats: ["atk", "def"],
      },
    }] }, game.player.id);
    game.player.fieldSpell = aura;
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([aberration.atk, aberration.def], [2800, 2300]);
    const simulated = clone();
    applySimulatedActions({ state: simulated.state, actions: [zero], selections: { void_monster_target: [simulated.card] } });
    assert.deepEqual(simulated.state._simUnsupportedActions || [], [], "proven field aura is now modeled");
    const activation = await activate();
    assert.equal(activation.success, true, activation.reason ?? undefined);
    const afterSuppression = clone();
    assert.deepEqual(afterSuppression.state._simUnsupportedActions || [], []);
    if (removeAura) {
      await game.moveCard(aura, game.player, "graveyard", { fromZone: "fieldSpell" });
      for (const entry of [simulated, afterSuppression]) moveCardToZone(entry.state.bot, required(entry.state.bot.fieldSpell), "graveyard", entry.state.bot, { state: entry.state });
    }
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([aberration.atk, aberration.def], [0, 0]);
    for (const entry of [simulated, afterSuppression]) {
      assert.deepEqual([entry.card.atk, entry.card.def], [0,0]);
      cleanupSimulatedEndTurn(entry.state);
      assert.deepEqual([entry.card.atk, entry.card.def], removeAura ? [2400,1900] : [2700,2200]);
      cleanupSimulatedEndTurn(entry.state);
      assert.deepEqual([entry.card.atk, entry.card.def], removeAura ? [2400,1900] : [2700,2200]);
    }
    cleanupTempBoosts(game.player);
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([aberration.atk, aberration.def], removeAura ? [2400, 1900] : [2700, 2200]);
    game.effectEngine.updatePassiveBuffs();
    assert.deepEqual([aberration.atk, aberration.def], removeAura ? [2400, 1900] : [2700, 2200]);
  });
}


const perCopyVoidEffects = [
  { cardId: 202, effectId: "void_walker_bounce_summon", zone: "field" },
  { cardId: 206, effectId: "void_ghost_wolf_direct", zone: "field" },
  { cardId: 212, effectId: "void_slayer_brute_hand_summon", zone: "hand" },
  { cardId: 213, effectId: "void_berserker_bounce_on_destroy", zone: "field" },
  { cardId: 214, effectId: "void_serpent_drake_hand_special", zone: "hand" },
  { cardId: 221, effectId: "thousand_arms_summon_from_hand", zone: "hand" },
  { cardId: 221, effectId: "thousand_arms_bounce_and_revive", zone: "field" },
] as const;

function perCopyVoidScenario(t: TestContext, config: typeof perCopyVoidEffects[number], disableChains: boolean) {
  const game = createGame(t, disableChains);
  const first = makeCard(config.cardId, game.player);
  const second = makeCard(config.cardId, game.player);
  const effect = required(first.effects.find(e => e.id === config.effectId));
  if (config.zone === "field") placeFieldCards(game.player.field, first, second);
  else game.player.hand.push(first, second);
  const hollows = Array.from({ length: config.cardId === 212 ? 4 : 2 }, () => {
    const card = makeCard(204, game.player); card.effects = []; return card;
  });
  if (config.zone === "hand") placeFieldCards(game.player.field, ...hollows);
  else if (config.cardId === 202) game.player.hand.push(...hollows);
  else if (config.cardId === 221) game.player.graveyard.push(...hollows);
  else if (config.cardId === 213) placeFieldCards(game.bot.field, makeCard(203, game.bot), makeCard(203, game.bot));
  const canUse = (card: Card) => game.checkEffectUsage({ card, player: game.player, effect }).ok;
  const activate = async (card: Card) => {
    if (config.cardId === 213) {
      const destroyed = makeCard(203, game.bot);
      game.bot.graveyard.push(destroyed);
      const payload = unsafeFixture<BattleDestroyEventPayload>(
        { attacker: card, attackerOwner: game.player, destroyed, destroyedOwner: game.bot, battleDestroyer: card },
        "Focused battle trigger fixture omits damage-step metadata unused by Berserker.");
      if (disableChains) {
        // NullChainSystem dispatch and usage reservation are no-ops. Exercise the collected
        // trigger with the canonical usage service explicitly; this is not an end-to-end event test.
        const triggers = await game.effectEngine.collectBattleDestroyTriggers(payload);
        const entry = required(triggers.entries.find(e => e.card === card));
        const reservation = required(game.reserveEffectUsage({ card, player: game.player, effect }));
        assert.ok("status" in reservation);
        const result = await game.runActivationPipeline(unsafeFixture<Parameters<typeof game.runActivationPipeline>[0]>(entry.config,
          "Collected trigger references concrete game cards behind the narrower trigger port."));
        assert.equal(result.success, true, result.reason || String(result.needsSelection));
        game.settleEffectUsage(reservation);
        return result;
      }
      return game.emit("battle_destroy", payload);
    }
    const cost = effect.targets?.find(target => target.intent === "cost");
    const selections = cost
      ? { [cost.id]: hollows.filter(c => game.player.field.includes(c)).slice(0, cost.count?.min ?? 1) }
      : config.cardId === 206 ? { ghost_self: [card] } : null;
    return game.tryActivateMonsterEffect(card, selections, config.zone, game.player, { effectId: effect.id });
  };
  return { game, first, second, effect, hollows, canUse, activate };
}

for (const config of perCopyVoidEffects) {
  for (const disableChains of [false, true]) {
    test(`Lote5 ${config.effectId} separa copias e renova no turno seguinte (sem Chain: ${disableChains})`, async t => {
      const { game, first, second, effect, canUse, activate } = perCopyVoidScenario(t, config, disableChains);
      await activate(first);
      assert.equal(canUse(first), false, "A used copy remains blocked without a reset");
      assert.equal(canUse(second), true, "The other copy has its own OPT");
      const state = createGameTreeCopy(game, game.player).state;
      const sibling = createGameTreeCopy(game, game.player).state;
      const findCopy = (copy: typeof state, card: Card) => required(
        [...copy.bot.hand, ...copy.bot.field].find(c => c.instanceId === card.instanceId));
      assert.equal(canUseSimulatedEffectUsage(state, effect, findCopy(state, first)), false);
      assert.equal(canUseSimulatedEffectUsage(state, effect, findCopy(state, second)), true);
      markSimulatedEffectUsage(state, effect, findCopy(state, second));
      assert.equal(canUseSimulatedEffectUsage(state, effect, findCopy(state, second)), false);
      assert.equal(canUseSimulatedEffectUsage(sibling, effect, findCopy(sibling, second)), true);
      assert.equal(canUse(second), true, "Simulation cannot consume live usage");
      await activate(second);
      assert.equal(canUse(second), false);
      if (config.cardId === 213) assert.equal(game.bot.hand.length, 2, "Each copy resolves its own battle trigger");
      game.turnCounter++;
      assert.equal(canUse(first), true);
      assert.equal(canUse(second), true);
    });
  }
  for (const negation of ["activation", "effect"] as const) {
    test(`Lote5 ${config.effectId} preserva activate sob negacao de ${negation}`, async t => {
      const { game, first, second, effect, canUse, activate } = perCopyVoidScenario(t, config, false);
      assert.ok(game.chainSystem instanceof ChainSystem);
      const chain = game.chainSystem;
      let observed = false;
      chain.offerChainResponses = async () => {
        const link = chain.getLastChainLink();
        if (link?.effectId === effect.id) {
          observed = true;
          assert.equal(canUse(first), false, "The source reserves its own use before responses");
          assert.equal(canUse(second), true);
          if (negation === "activation") chain.markChainLinkActivationNegated(link);
          else chain.markChainLinkEffectNegated(link);
        }
        return passedResponses;
      };
      await activate(first);
      assert.equal(observed, true);
      assert.equal(canUse(first), negation === "activation");
      assert.equal(canUse(second), true);
    });
  }
}

for (const disableChains of [false, true]) {
  test(`Lote5 Mil Bracos tem dois limites independentes e preserva historico da 223 (sem Chain: ${disableChains})`, async t => {
    const config = required(perCopyVoidEffects.find(e => e.effectId === "thousand_arms_summon_from_hand"));
    const { game, first, second, activate, canUse } = perCopyVoidScenario(t, config, disableChains);
    const bounce = required(first.effects.find(e => e.id === "thousand_arms_bounce_and_revive"));
    await activate(first);
    assert.equal(canUse(first), false);
    assert.equal(game.checkEffectUsage({ card: first, player: game.player, effect: bounce }).ok, true);
    assert.equal((await game.tryActivateMonsterEffect(first, null, "field", game.player, { effectId: bounce.id })).success, true);
    assert.equal(game.checkEffectUsage({ card: first, player: game.player, effect: bounce }).ok, false);
    assert.equal(game.checkEffectUsage({ card: second, player: game.player, effect: bounce }).ok, true);
    assert.equal(canUse(second), true);
    assert.deepEqual([...required(game.materialDuelStats.player.activatedEffectIdsByMaterialId.get(221))].sort(),
      [config.effectId, bounce.id].sort());
  });

  for (const cardId of [206, 213] as const) {
    test(`Lote5 ${cardId} preserva reset existente ao sair do campo (sem Chain: ${disableChains})`, async t => {
      const config = required(perCopyVoidEffects.find(e => e.cardId === cardId));
      const { game, first, canUse, activate } = perCopyVoidScenario(t, config, disableChains);
      await activate(first);
      assert.equal(canUse(first), false);
      await game.moveCard(first, game.player, "graveyard", { fromZone: "field" });
      assert.equal(canUse(first), true);
      await game.moveCard(first, game.player, "field", { fromZone: "graveyard", summonOrigin: "effect_resolution" });
      assert.equal(canUse(first), true);
    });
  }

  for (const config of perCopyVoidEffects.filter(e => e.zone === "hand")) {
    for (const failure of ["cancel", "payment"] as const) {
      test(`Lote5 ${config.effectId} nao consome OPT em ${failure} (sem Chain: ${disableChains})`, async t => {
        const { game, first, second, effect, canUse, activate } = perCopyVoidScenario(t, config, disableChains);
        if (failure === "cancel") {
          game.player.controllerType = "human";
          const pending = game.tryActivateMonsterEffect(first, null, "hand", game.player, { effectId: effect.id });
          for (let attempt = 0; attempt < 100 && !game.targetSelection; attempt++) await new Promise(resolve => setImmediate(resolve));
          assert.ok(game.targetSelection);
          game.cancelTargetSelection();
          assert.equal((await pending).success, false);
        } else {
          const move = game.moveCard.bind(game);
          t.mock.method(game, "moveCard", (...args: Parameters<typeof game.moveCard>) =>
            args[2] === "graveyard" ? false : Reflect.apply(move, game, args));
          await activate(first);
          assert.ok(game.player.hand.includes(first));
        }
        assert.equal(canUse(first), true);
        assert.equal(canUse(second), true);
      });
    }
  }
}

const batchFourEffects = {
  202: { id: "void_walker_bounce_summon", zone: "field", costRef: null },
  212: { id: "void_slayer_brute_hand_summon", zone: "hand", costRef: "void_slayer_brute_cost" },
  214: { id: "void_serpent_drake_hand_special", zone: "hand", costRef: "void_serpent_drake_hollow_cost" },
  221: { id: "thousand_arms_bounce_and_revive", zone: "field", costRef: null },
} as const;

for (const disableChains of [false, true]) {
  test(`Lote4 202 recusa outras copias de Walker antes de pagar (sem Chain: ${disableChains})`, async t => {
    const { game, source, recruit, activate } = batchFourScenario(t, 202, disableChains);
    game.player.hand.splice(game.player.hand.indexOf(recruit), 1);
    game.player.hand.push(makeCard(202, game.player));
    assert.equal((await activate()).success, false);
    assert.ok(game.player.field.includes(source));
  });
}

test("Lote4 202 preserva restricao de ataque apos Invocacao-Especial", async t => {
  const game = createGame(t);
  const walker = makeCard(202, game.player);
  game.player.hand.push(walker);
  await game.moveCard(walker, game.player, "field", {
    fromZone: "hand", summonOrigin: "effect_resolution", summonMethodOverride: "special", position: "attack",
  });
  // A direct effect-resolution move leaves triggers pending until the effect boundary.
  await game.flushPendingTriggerOccurrences();
  assert.ok(game.player.field.includes(walker));
  assert.equal(walker.cannotAttackThisTurn, true);
});

for (const id of [212, 214] as const) {
  test(`Lote4 IA ${id} não registra ativação com custo redirecionado`, t => {
    const game = createGame(t);
    game.turn = "bot";
    const source = makeCard(id, game.bot);
    game.bot.hand.push(source);
    placeFieldCards(game.bot.field, makeCard(204, game.bot));
    if (id === 212) placeFieldCards(game.bot.field, makeCard(203, game.bot));
    placeFieldCards(game.player.field, makeCard(273, game.player));
    const state = createGameTreeCopy(game).state;
    delete state._gameRef;
    const simSource = required(state.bot.hand[0]);
    const strategy = new VoidStrategy(state.bot);
    strategy.simulateMainPhaseAction(state, { type: "handIgnition", index: 0, cardId: id, effectId: batchFourEffects[id].id });
    assert.ok(state.bot.hand.includes(simSource));
    assert.equal(state.bot.field.includes(simSource), false);
    assert.equal(state.materialDuelStats?.bot?.activatedEffectIdsByMaterialId?.has(id) ?? false, false);
    assert.equal(Reflect.get(state, "_simMaterialEffectActivationsByMaterialId"), undefined);
    assert.equal(simSource.effectMarkers?.void_slayer_brute_hollow_cost, undefined);
  });
}

for (const disableChains of [false, true]) {
  for (const id of [212, 214] as const) {
    test(`Lote4 ${id} cancelar selecao humana preserva custos (sem Chain: ${disableChains})`, async t => {
      const { game, source, config, costs } = batchFourScenario(t, id, disableChains);
      game.player.controllerType = "human";
      const activation = game.tryActivateMonsterEffect(source, null, config.zone, game.player, { effectId: config.id });
      for (let attempt = 0; attempt < 100 && !game.targetSelection; attempt++) await new Promise(resolve => setImmediate(resolve));
      assert.ok(game.targetSelection);
      game.cancelTargetSelection();
      assert.equal((await activation).success, false);
      assert.ok(game.player.hand.includes(source));
      for (const cost of costs) assert.ok(game.player.field.includes(cost));
    });
  }
  for (const id of [202, 221] as const) {
    for (const count of id === 202 ? [1] : [0, 1, 2]) {
      test(`Lote4 ${id} escolha humana de ${count} Invocacoes ocorre apos custo (sem Chain: ${disableChains})`, async t => {
        const { game, source, copy, recruit, activate } = batchFourScenario(t, id, disableChains);
        const second = makeCard(204, game.player); second.effects = [];
        game.player[id === 202 ? "hand" : "graveyard"].push(second);
        game.player.controllerType = "human";
        let choices = 0;
        t.mock.method(game, "startTargetSelectionSession", (input: Parameters<typeof game.startTargetSelectionSession>[0]) => {
          choices++;
          assert.ok(game.player.hand.includes(source));
          assert.ok(game.player.field.includes(copy));
          assert.ok(input);
          const normalized = game.normalizeSelectionContract(input.selectionContract);
          assert.ok(normalized.ok);
          const requirement = required(normalized.contract.requirements[0]);
          const candidates = required(requirement.candidates);
          assert.equal(candidates.some(c => c.cardRef === source || c.cardRef === copy), false);
          const selected = [recruit, second].slice(0, count).map(card => required(candidates.find(c => c.cardRef === card)?.key));
          input.execute?.({ [requirement.id]: selected });
        });
        let positions = 0;
        game.ui.showSpecialSummonPositionModal = (_card, choose) => { positions++; choose("defense"); };
        assert.equal((await activate()).success, true);
        assert.equal(choices, 1);
        assert.equal(positions, count);
        for (const card of [recruit, second].slice(0, count)) {
          assert.ok(game.player.field.includes(card));
          assert.equal(card.position, "defense");
        }
      });
    }
  }
}

for (const id of [202, 212, 214, 221] as const) {
  for (const legal of [false, true]) {
    test(`Lote4 IA ${id} valida antes de pagar e simula o custo (legal: ${legal})`, t => {
      const game = createGame(t);
      game.turn = "bot";
      const source = makeCard(id, game.bot);
      const config = batchFourEffects[id];
      if (config.zone === "field") placeFieldCards(game.bot.field, source);
      else game.bot.hand.push(source);
      if (id === 202) game.bot.hand.push(makeCard(legal ? 204 : 202, game.bot));
      if (id === 221) game.bot.graveyard.push(makeCard(204, game.bot));
      if (id === 212 || id === 214) {
        placeFieldCards(game.bot.field, makeCard(204, game.bot));
        if (id === 212 && legal) placeFieldCards(game.bot.field, makeCard(203, game.bot));
        if (id === 214 && !legal) required(game.bot.field[0]).isToken = true;
      }
      if (legal) {
        while (game.bot.field.length < 5) {
          const filler = makeCard(203, game.bot);
          filler.archetype = "Other";
          filler.archetypes = [];
          filler.effects = [];
          placeFieldCards(game.bot.field, filler);
        }
      }
      const state = createGameTreeCopy(game).state;
      delete state._gameRef;
      const simSource = required(state.bot[config.zone][0]);
      const strategy = new VoidStrategy(state.bot);
      const action = config.zone === "field"
        ? { type: "monsterEffect", fieldIndex: 0, cardId: id, effectId: config.id } as const
        : { type: "handIgnition", index: 0, cardId: id, effectId: config.id } as const;
      strategy.simulateMainPhaseAction(state, action);
      // 221 preserves the existing zero-to-two selection, so its activation is legal in both cases.
      const shouldActivate = legal || id === 221;
      assert.equal(state.bot[config.zone].includes(simSource), !shouldActivate);
      if (id === 212 && legal) assert.equal(simSource.effectMarkers?.void_slayer_brute_hollow_cost?.matchingCostCount, 1);
      assert.equal(game.bot[config.zone].includes(source), true, "Simulation must not mutate the live state");
    });
  }
}

function batchFourScenario(t: TestContext, id: keyof typeof batchFourEffects, disableChains = false) {
  const game = createGame(t, disableChains);
  const source = makeCard(id, game.player);
  const copy = makeCard(id, game.player);
  const hollow = makeCard(204, game.player);
  const secondCost = makeCard(203, game.player);
  const recruit = makeCard(204, game.player);
  const config = batchFourEffects[id];
  hollow.effects = [];
  secondCost.effects = [];
  recruit.effects = [];
  if (config.zone === "hand") {
    game.player.hand.push(copy, source);
    placeFieldCards(game.player.field, hollow);
    if (id === 212) placeFieldCards(game.player.field, secondCost);
  } else {
    placeFieldCards(game.player.field, copy, source);
    game.player[id === 202 ? "hand" : "graveyard"].push(recruit);
  }
  const costs = config.costRef ? id === 212 ? [hollow, secondCost] : [hollow] : [];
  const selections = config.costRef ? { [config.costRef]: costs } : null;
  const activate = () => game.tryActivateMonsterEffect(source, selections, config.zone, game.player, { effectId: config.id });
  return { game, source, copy, hollow, secondCost, recruit, config, costs, activate };
}

for (const id of [202, 212, 214, 221] as const) {
  for (const disableChains of [false, true]) {
    test(`Lote4 ${id} paga antes das respostas e libera campo cheio (sem Chain: ${disableChains})`, async t => {
      const { game, source, copy, recruit, config, costs, activate } = batchFourScenario(t, id, disableChains);
      placeFieldCards(game.player.field, ...Array.from({ length: 5 - game.player.field.length }, () => makeCard(203, game.player)));
      let responseObserved = false;
      if (game.chainSystem instanceof ChainSystem) {
        const chain = game.chainSystem;
        chain.offerChainResponses = async () => {
          if (chain.getLastChainLink()?.effectId !== config.id) return passedResponses;
          responseObserved = true;
          if (config.costRef) {
            for (const cost of costs) assert.equal(game.player.graveyard.includes(cost), true);
            assert.equal(game.player.hand.includes(source), true);
          } else {
            assert.equal(game.player.hand.includes(source), true);
            assert.equal(game.player.field.includes(copy), true);
            assert.equal(game.player.field.includes(recruit), false);
          }
          return passedResponses;
        };
      }
      assert.equal((await activate()).success, true);
      assert.equal(game.player.field.includes(config.costRef ? source : recruit), true);
      assert.equal(game.player[config.costRef ? "hand" : "field"].includes(copy), true);
      if (!disableChains) assert.equal(responseObserved, true);
    });
  }
  for (const negation of ["activation", "effect"] as const) {
    test(`Lote4 ${id} mantém custo após negação de ${negation}`, async t => {
      const { game, source, recruit, config, costs, activate } = batchFourScenario(t, id);
      assert.ok(game.chainSystem instanceof ChainSystem);
      const chain = game.chainSystem;
      chain.offerChainResponses = async () => {
        const link = chain.getLastChainLink();
        if (link?.effectId === config.id) {
          if (negation === "activation") chain.markChainLinkActivationNegated(link);
          else chain.markChainLinkEffectNegated(link);
        }
        return passedResponses;
      };
      await activate();
      assert.equal(game.player.hand.includes(source), true);
      for (const cost of costs) assert.equal(game.player.graveyard.includes(cost), true);
      assert.equal(game.player.field.includes(config.costRef ? source : recruit), false);
      assert.equal(source.effectMarkers?.void_slayer_brute_hollow_cost, undefined);
    });
  }
}

for (const disableChains of [false, true]) {
  for (const hasHollow of [false, true]) {
    test(`Lote4 212 vincula bônus ao custo pago e à presença no campo (Hollow: ${hasHollow}, sem Chain: ${disableChains})`, async t => {
      const { game, source, copy, hollow, config, activate } = batchFourScenario(t, 212, disableChains);
      if (!hasHollow) hollow.name = "Void Beast";
      if (game.chainSystem instanceof ChainSystem) {
        const chain = game.chainSystem;
        chain.offerChainResponses = async () => {
          if (chain.getLastChainLink()?.effectId === config.id) {
            // Both location and name can change after payment; the evidence must not.
            await game.moveCard(hollow, game.player, "banished", { fromZone: "graveyard" });
            hollow.name = hasHollow ? "Void Beast" : "Void Hollow";
          }
          return passedResponses;
        };
      }
      assert.equal((await activate()).success, true);
      assert.equal(Boolean(source.effectMarkers?.void_slayer_brute_hollow_cost), hasHollow);
      assert.equal(copy.effectMarkers?.void_slayer_brute_hollow_cost, undefined);
      const victim = makeCard(203, game.bot);
      game.bot.graveyard.push(victim);
      const resolveBattle = async (destroyed: Card) => {
        const payload = unsafeFixture<BattleDestroyEventPayload>(
          { attacker: source, attackerOwner: game.player, destroyed, destroyedOwner: game.bot, battleDestroyer: source },
          "Focused battle trigger fixture omits damage-step metadata unused by this effect.");
        if (disableChains) {
          // NullChainSystem does not dispatch events; execute the collected trigger through the real activation pipeline.
          const triggers = await game.effectEngine.collectBattleDestroyTriggers(payload);
          for (const entry of triggers.entries.filter(e => e.card === source)) {
            await game.runActivationPipeline(unsafeFixture<Parameters<typeof game.runActivationPipeline>[0]>(entry.config,
              "Collected trigger uses concrete game cards and players behind the narrower trigger port."));
          }
        } else await game.emit("battle_destroy", payload);
      };
      await resolveBattle(victim);
      assert.equal(game.bot.banished.includes(victim), hasHollow);
      await game.moveCard(source, game.player, "graveyard", { fromZone: "field" });
      await game.moveCard(source, game.player, "field", { fromZone: "graveyard", position: "attack", summonOrigin: "effect_resolution" });
      const secondVictim = makeCard(203, game.bot);
      game.bot.graveyard.push(secondVictim);
      await resolveBattle(secondVictim);
      assert.equal(game.bot.banished.includes(secondVictim), false);
    });
  }
  for (const invalid of ["missing", "duplicate", "token", "second_move_fails"] as const) {
    test(`Lote4 212 rejeita pagamento ${invalid} (sem Chain: ${disableChains})`, async t => {
      const { game, source, hollow, secondCost, config, activate } = batchFourScenario(t, 212, disableChains);
      if (invalid === "missing") await game.moveCard(secondCost, game.player, "hand", { fromZone: "field" });
      if (invalid === "token") secondCost.isToken = true;
      if (invalid === "second_move_fails") {
        const move = game.moveCard.bind(game);
        t.mock.method(game, "moveCard", (card: Card, owner: GamePlayer, zone: Parameters<typeof game.moveCard>[2], options: Parameters<typeof game.moveCard>[3]) =>
          card === secondCost && zone === "graveyard" ? { success: false, reason: "test_block_second_cost" } : move(card, owner, zone, options));
      }
      let published = 0;
      game.on("effect_activated", payload => { if (payload.effectId === config.id) published++; });
      const result = invalid === "duplicate"
        ? await game.tryActivateMonsterEffect(source, { void_slayer_brute_cost: [hollow, hollow] }, "hand", game.player, { effectId: config.id })
        : await activate();
      assert.equal(result.success, false);
      assert.equal(game.player.hand.includes(source), true);
      assert.equal(published, 0);
      assert.equal(source.effectMarkers?.void_slayer_brute_hollow_cost, undefined);
      if (invalid !== "second_move_fails") assert.equal(game.player.field.includes(hollow), true);
    });
  }
}

for (const disableChains of [false, true]) {
  test(`208 envia Hollow da mão e rejeita ativação sem Hollow (sem Chain: ${disableChains})`, async (t) => {
    const game = createGame(t, disableChains);
    const source = makeCard(208, game.player);
    const hollow = makeCard(204, game.player);
    const target = makeCard(205, game.bot);
    placeFieldCards(game.player.field, source);
    placeFieldCards(game.bot.field, target);
    const activate = () => game.tryActivateMonsterEffect(source, { void_bone_spider_lock_target: [target] }, "field", game.player, { effectId: "void_bone_spider_lock" });
    assert.equal((await activate()).success, false);
    game.player.hand.push(hollow);
    assert.equal((await activate()).success, true);
    assert.equal(game.player.graveyard.includes(hollow), true);
    assert.equal(target.cannotAttackUntilTurn, 3);
  });
  test(`226 pode enviar a própria fonte (sem Chain: ${disableChains})`, async (t) => {
    const game = createGame(t, disableChains);
    const source = makeCard(226, game.player);
    const target = makeCard(205, game.bot);
    target.effects = [];
    placeFieldCards(game.player.field, source);
    placeFieldCards(game.bot.field, target);
    const result = await game.tryActivateMonsterEffect(source, { void_shadow_crawler_destroy_target: [target] }, "field", game.player, { effectId: "void_shadow_crawler_destroy_high_level" });
    assert.equal(result.success, true);
    assert.deepEqual(game.player.graveyard, [source]);
    assert.deepEqual(game.bot.graveyard, [target]);
  });
  for (const unavailable of ["empty", "full"] as const) {
    test(`225 não paga quando ${unavailable} (sem Chain: ${disableChains})`, async (t) => {
      const game = createGame(t, disableChains);
      const source = makeCard(225, game.player);
      game.player.graveyard.push(source, makeCard(224, game.player));
      if (unavailable === "full") {
        game.player.graveyard.push(makeCard(204, game.player));
        placeFieldCards(game.player.field, ...Array.from({ length: 5 }, () => makeCard(204, game.player)));
      }
      assert.equal((await game.tryActivateMonsterEffect(source, null, "graveyard", game.player, { effectId: "arcturus_fallen_gy_revival" })).success, false);
      assert.equal(game.player.graveyard.includes(source), true);
      assert.equal(game.player.banished.length, 0);
    });
  }
  for (const count of [1, 2, 3]) {
    test(`225 permite escolher ${count} nomes distintos e suas posições (sem Chain: ${disableChains})`, async (t) => {
      const game = createGame(t, disableChains);
      const source = makeCard(225, game.player);
      const excluded = makeCard(224, game.player);
      const recruits = [makeCard(204, game.player), makeCard(201, game.player), makeCard(202, game.player)];
      recruits.forEach(card => { card.effects = []; });
      game.player.graveyard.push(source, excluded, ...recruits, makeCard(204, game.player));
      game.player.controllerType = "human";
      t.mock.method(game, "startTargetSelectionSession", (input: Parameters<typeof game.startTargetSelectionSession>[0]) => {
        assert.equal(game.player.banished.includes(source), true);
        assert.ok(input);
        const normalized = game.normalizeSelectionContract(input.selectionContract);
        assert.ok(normalized.ok);
        const requirement = required(normalized.contract.requirements[0]);
        const candidates = required(requirement.candidates);
        assert.equal(candidates.some(c => c.cardRef === source || c.cardRef === excluded), false);
        assert.equal(new Set(candidates.map(c => c.cardRef?.name)).size, candidates.length);
        const selected = recruits.slice(0, count).map(card => required(candidates.find(c => c.cardRef === card)?.key));
        input.execute?.({ [requirement.id]: selected });
      });
      let positions = 0;
      game.ui.showSpecialSummonPositionModal = (_card, choose) => { positions++; choose(positions % 2 ? "defense" : "attack"); };
      assert.equal((await game.tryActivateMonsterEffect(source, null, "graveyard", game.player, { effectId: "arcturus_fallen_gy_revival" })).success, true);
      assert.equal(positions, count);
      assert.deepEqual(game.player.field, recruits.slice(0, count));
      for (const [index, card] of game.player.field.entries()) {
        assert.equal(card.effectsNegated, true);
        assert.equal(card.position, index % 2 ? "attack" : "defense");
      }
    });
  }
}

for (const outcome of ["effect_negated", "activation_negated", "candidates_left", "field_filled"] as const) {
  test(`225 mantém o banimento após ${outcome}`, async (t) => {
    const game = createGame(t);
    const source = makeCard(225, game.player);
    const revive = makeCard(204, game.player);
    game.player.graveyard.push(source, revive);
    assert.ok(game.chainSystem instanceof ChainSystem);
    const chain = game.chainSystem;
    chain.offerChainResponses = async () => {
      const link = chain.getLastChainLink();
      if (link?.effectId !== "arcturus_fallen_gy_revival") return passedResponses;
      assert.deepEqual(game.player.banished, [source]);
      if (outcome === "effect_negated") chain.markChainLinkEffectNegated(link);
      if (outcome === "activation_negated") chain.markChainLinkActivationNegated(link);
      if (outcome === "candidates_left") await game.moveCard(revive, game.player, "hand", { fromZone: "graveyard" });
      if (outcome === "field_filled") placeFieldCards(game.player.field, ...Array.from({ length: 5 }, () => makeCard(204, game.player)));
      return passedResponses;
    };
    await game.tryActivateMonsterEffect(source, null, "graveyard", game.player, { effectId: "arcturus_fallen_gy_revival" });
    assert.deepEqual(game.player.banished, [source]);
    assert.equal(game.player.field.includes(revive), false);
  });
}

for (const id of [208, 226] as const) {
  for (const token of [false, true]) {
    test(`IA ${id} condiciona a consequência ao envio ao Cemitério (ficha: ${token})`, (t) => {
      const game = createGame(t);
      const source = makeCard(id, game.bot);
      const send = makeCard(204, game.bot);
      const target = makeCard(205, game.player);
      send.isToken = token;
      placeFieldCards(game.bot.field, source, send);
      placeFieldCards(game.player.field, target);
      const state = createGameTreeCopy(game).state;
      const simSource = required(state.bot.field[0]);
      const simSend = required(state.bot.field[1]);
      const simTarget = required(state.player.field[0]);
      const effect = required(simSource.effects?.find(e => e.timing === "ignition"));
      const ownRef = id === 208 ? "void_bone_spider_hollow_send" : "void_shadow_crawler_send";
      const targetRef = id === 208 ? "void_bone_spider_lock_target" : "void_shadow_crawler_destroy_target";
      applySimulatedActions({ actions: effect.actions, selections: { [ownRef]: [simSend], [targetRef]: [simTarget] }, state, selfId: "bot", options: { sourceCard: simSource, effect } });
      assert.equal(state.bot.graveyard.includes(simSend), !token);
      if (id === 208) assert.equal(Boolean(simTarget.cannotAttackThisTurn), !token);
      else assert.equal(state.player.graveyard.includes(simTarget), !token);
    });
  }
}

for (const id of [208, 226] as const) {
  const effectId = id === 208 ? "void_bone_spider_lock" : "void_shadow_crawler_destroy_high_level";
  const targetId = id === 208 ? "void_bone_spider_lock_target" : "void_shadow_crawler_destroy_target";
  for (const disableChains of [false, true]) {
    test(`${id} escolhe e envia somente durante a resolução (sem Chain: ${disableChains})`, async (t) => {
      const game = createGame(t, disableChains);
      const source = makeCard(id, game.player);
      const send = makeCard(204, game.player);
      const target = makeCard(205, game.bot);
      send.effects = [];
      target.effects = [];
      placeFieldCards(game.player.field, source, send);
      placeFieldCards(game.bot.field, target);
      game.player.controllerType = "human";
      let responses = 0;
      let choices = 0;
      if (game.chainSystem instanceof ChainSystem) {
        const chain = game.chainSystem;
        chain.offerChainResponses = async () => {
          if (chain.getLastChainLink()?.effectId !== effectId) return passedResponses;
          responses++;
          assert.equal(choices, 0);
          assert.equal(game.player.field.includes(send), true);
          return passedResponses;
        };
      }
      t.mock.method(game, "startTargetSelectionSession", (input: Parameters<typeof game.startTargetSelectionSession>[0]) => {
        choices++;
        if (!disableChains) assert.ok(responses > 0);
        assert.ok(input);
        assert.equal(input.allowCancel, false);
        const normalized = game.normalizeSelectionContract(input.selectionContract);
        assert.ok(normalized.ok);
        const requirement = required(normalized.contract.requirements[0]);
        const candidate = required(requirement.candidates?.find(c => c.cardRef === send));
        input.execute?.({ [requirement.id]: [required(candidate.key)] });
      });
      const result = await game.tryActivateMonsterEffect(source, { [targetId]: [target] }, "field", game.player, { effectId });
      assert.equal(result.success, true, result.reason || undefined);
      assert.equal(choices, 1);
      assert.equal(game.player.graveyard.includes(send), true);
      if (id === 208) assert.equal(target.cannotAttackUntilTurn, 3);
      else assert.equal(game.bot.graveyard.includes(target), true);
    });
  }
  for (const outcome of ["effect_negated", "activation_negated", "target_left", "send_missing", "send_failed", "redirected", "token"] as const) {
    test(`${id} respeita ${outcome} durante a Chain`, async (t) => {
      const game = createGame(t);
      const source = makeCard(id, game.player);
      const send = makeCard(204, game.player);
      const target = makeCard(205, game.bot);
      const replacement = makeCard(205, game.bot);
      send.effects = [];
      target.effects = [];
      replacement.effects = [];
      if (outcome === "token") send.isToken = true;
      placeFieldCards(game.player.field, source, send);
      placeFieldCards(game.bot.field, target, replacement);
      assert.ok(game.chainSystem instanceof ChainSystem);
      const chain = game.chainSystem;
      chain.offerChainResponses = async () => {
        const link = required(chain.getLastChainLink());
        assert.equal(game.player.field.includes(send), true);
        if (outcome === "effect_negated") chain.markChainLinkEffectNegated(link);
        if (outcome === "activation_negated") chain.markChainLinkActivationNegated(link);
        if (outcome === "target_left") await game.moveCard(target, game.bot, "hand", { fromZone: "field" });
        if (outcome === "send_missing") {
          await game.moveCard(send, game.player, "banished", { fromZone: "field" });
          if (id === 226) await game.moveCard(source, game.player, "banished", { fromZone: "field" });
        }
        return passedResponses;
      };
      const moveCard = game.moveCard.bind(game);
      if (outcome === "send_failed") {
        t.mock.method(game, "moveCard", (card: Card, owner: GamePlayer, zone: Parameters<typeof game.moveCard>[2], options: Parameters<typeof game.moveCard>[3]) =>
          card === send && zone === "graveyard" ? { success: false, reason: "test_move_blocked" } : moveCard(card, owner, zone, options));
      }
      if (outcome === "redirected") {
        t.mock.method(game, "moveCard", (card: Card, owner: GamePlayer, zone: Parameters<typeof game.moveCard>[2], options: Parameters<typeof game.moveCard>[3]) =>
          moveCard(card, owner, card === send && zone === "graveyard" ? "banished" : zone, options));
      }
      // A deterministic bot choice; human selection is exercised above.
      const resolve = game.effectEngine.resolveTargets.bind(game.effectEngine);
      t.mock.method(game.effectEngine, "resolveTargets", (...args: Parameters<typeof resolve>) => {
        const [defs, ctx, selections] = args;
        const own = defs?.find(d => d !== null && typeof d === "object" && Reflect.get(d, "owner") === "self");
        const ownId = own && typeof own === "object" ? Reflect.get(own, "id") : null;
        return resolve(defs, ctx, typeof ownId === "string" && outcome !== "send_missing" ? { ...selections, [ownId]: [send] } : selections);
      });
      await game.tryActivateMonsterEffect(source, { [targetId]: [target] }, "field", game.player, { effectId });
      assert.equal(target.cannotAttackUntilTurn, null);
      assert.equal(game.bot.graveyard.includes(target), false);
      assert.equal(game.bot.field.includes(replacement), true);
      assert.equal(replacement.cannotAttackUntilTurn, null);
      if (outcome === "target_left") assert.equal(game.player.graveyard.includes(send), true);
      if (outcome.endsWith("negated")) assert.equal(game.player.field.includes(send), true);
      if (outcome === "redirected") assert.equal(game.player.banished.includes(send), true);
      if (outcome === "token") assert.equal(game.player.graveyard.includes(send), false);
    });
  }
}

for (const disableChains of [false, true]) {
  test(`225 bane a própria cópia antes da resolução (sem Chain: ${disableChains})`, async (t) => {
    const game = createGame(t, disableChains);
    const other = makeCard(225, game.player);
    const source = makeCard(225, game.player);
    const revive = makeCard(204, game.player);
    game.player.graveyard.push(other, source, revive);
    let response = false;
    if (game.chainSystem instanceof ChainSystem) {
      const chain = game.chainSystem;
      chain.offerChainResponses = async () => {
        if (chain.getLastChainLink()?.effectId !== "arcturus_fallen_gy_revival") return passedResponses;
        response = true;
        assert.deepEqual(game.player.banished, [source]);
        assert.equal(game.player.field.length, 0);
        return passedResponses;
      };
    }
    const result = await game.tryActivateMonsterEffect(source, null, "graveyard", game.player, { effectId: "arcturus_fallen_gy_revival" });
    assert.equal(result.success, true);
    assert.deepEqual(game.player.banished, [source]);
    assert.deepEqual(game.player.graveyard, [other]);
    assert.equal(game.player.field.includes(revive), true);
    assert.equal(revive.effectsNegated, true);
    if (!disableChains) assert.equal(response, true);
  });
}

for (const outcome of ["success", "effect_negated", "activation_negated", "declined"] as const) {
  for (const disableChains of [false, true]) {
    if (disableChains && outcome.includes("negated")) continue;
    test(`210 paga somente a própria cópia: ${outcome} (sem Chain: ${disableChains})`, async (t) => {
      const game = createGame(t, disableChains);
      const other = makeCard(210, game.player);
      const source = makeCard(210, game.player);
      const fusion = makeCard(227, game.player);
      game.player.hand.push(other, source);
      placeFieldCards(game.player.field, fusion);
      game.player.controllerType = "human";
      game.ui.showConfirmPrompt = async () => outcome !== "declined";
      if (game.chainSystem instanceof ChainSystem) {
        const chain = game.chainSystem;
        chain.offerChainResponses = async () => {
          assert.equal(game.player.graveyard.includes(source), true);
          assert.equal(game.player.hand.includes(other), true);
          const link = required(chain.getLastChainLink());
          if (outcome === "effect_negated") chain.markChainLinkEffectNegated(link);
          if (outcome === "activation_negated") chain.markChainLinkActivationNegated(link);
          return passedResponses;
        };
      }
      const triggers = await game.effectEngine.collectAfterSummonTriggers({ card: fusion, player: game.player, method: "fusion", fromZone: "extraDeck" });
      const entry = required(triggers.entries.find(e => e.card === source));
      await game.runActivationPipeline(unsafeFixture<Parameters<typeof game.runActivationPipeline>[0]>(entry.config, "Collected trigger uses the concrete game cards and players behind the narrower trigger port."));
      assert.equal(game.player.hand.includes(other), true);
      assert.equal(game.player.graveyard.includes(source), outcome !== "declined");
      assert.equal(fusion.immuneToOpponentEffectsUntilTurn, outcome === "success" ? 3 : null);
      if (!disableChains) {
        const effect = required(source.effects.find(e => e.id === "void_raven_fusion_immunity"));
        const canUse = (card: Card, player = game.player) => game.checkEffectUsage({ card, player, effect }).ok;
        assert.equal(canUse(other), outcome === "declined", "Hard OPT is shared even when activation is negated");
        const opponentCopy = makeCard(210, game.bot);
        game.bot.hand.push(opponentCopy);
        assert.equal(canUse(opponentCopy, game.bot), true, "The opponent has an independent limit");
        const state = createGameTreeCopy(game, game.player).state;
        const simulatedOther = required(state.bot.hand.find(c => c.instanceId === other.instanceId));
        assert.equal(canUseSimulatedEffectUsage(state, effect, simulatedOther), outcome === "declined");
        const subsequent = await game.effectEngine.collectAfterSummonTriggers({ card: fusion, player: game.player, method: "fusion", fromZone: "extraDeck" });
        assert.equal(subsequent.entries.some(e => e.card === other), outcome === "declined");
        game.turnCounter++;
        assert.equal(canUse(other), true, "Hard OPT renews next turn");
      }
    });
  }
}

const thousandArmsEffects = [
  "thousand_arms_summon_from_hand",
  "thousand_arms_bounce_and_revive",
] as const;

test("IA Void exige os dois efeitos para oferecer o 223", (t) => {
  const game = createGame(t);
  game.turn = "bot";
  game.player.lp = 1000;
  const material = makeCard(221, game.bot);
  material.summonedTurn = 0;
  placeFieldCards(game.bot.field, material);
  game.bot.extraDeck.push(makeCard(223, game.bot));
  game.bot.graveyard.push(...Array.from({ length: 4 }, () => makeCard(204, game.bot)));
  for (let i = 0; i < 2; i++) game.recordMaterialEffectActivation(game.bot, material, { effectId: thousandArmsEffects[0] });
  const blocked = createGameTreeCopy(game).state;
  delete blocked._gameRef;
  const firstStrategy = new VoidStrategy(blocked.bot);
  assert.equal(firstStrategy.generateMainPhaseActions(blocked).some(a => a.type === "ascension"), false);
  game.recordMaterialEffectActivation(game.bot, material, { effectId: thousandArmsEffects[1] });
  const ready = createGameTreeCopy(game).state;
  delete ready._gameRef;
  assert.equal(new VoidStrategy(ready.bot).generateMainPhaseActions(ready).some(a => a.type === "ascension"), true);
});

for (const phase of ["discovery", "simulation"] as const) {
  test(`IA não ativa Mil Braços sem custo válido (${phase})`, (t) => {
    const game = createGame(t);
    game.turn = "bot";
    game.bot.hand.push(makeCard(221, game.bot));
    const state = createGameTreeCopy(game).state;
    delete state._gameRef;
    const strategy = new VoidStrategy(state.bot);
    if (phase === "discovery") {
      assert.equal(strategy.generateMainPhaseActions(state).some(a => a.type === "handIgnition"), false);
      const card = required(state.bot.hand[0]);
      assert.equal(validateHandIgnitionCandidate({
        player: state.bot, card,
        effect: required(card.effects?.find(e => e.id === thousandArmsEffects[0])),
        isSimulatedState: true,
      }).ok, false);
    } else {
      strategy.simulateMainPhaseAction(state, { type: "handIgnition", index: 0, cardId: 221, effectId: thousandArmsEffects[0] });
      assert.equal(state.bot.field.length, 0);
      assert.equal(state.bot.hand.length, 1);
      assert.equal(state.materialDuelStats?.bot.activatedEffectIdsByMaterialId.has(221), false);
    }
  });
}

test("Simulação Void combina histórico real e simulado sem alterar outras cópias do estado", (t) => {
  const game = createGame(t);
  game.turn = "bot";
  const material = makeCard(221, game.bot);
  placeFieldCards(game.bot.field, material);
  game.bot.graveyard.push(makeCard(204, game.bot));
  game.recordMaterialEffectActivation(game.bot, material, { effectId: thousandArmsEffects[0] });
  const initial = createGameTreeCopy(game).state;
  const branch = createGameTreeCopy(initial).state;
  delete branch._gameRef;
  const strategy = new VoidStrategy(branch.bot);
  strategy.simulateMainPhaseAction(branch, {
    type: "monsterEffect", fieldIndex: 0, cardName: material.name, effectId: thousandArmsEffects[1],
  });
  assert.deepEqual([...required(branch.materialDuelStats?.bot.activatedEffectIdsByMaterialId.get(221))].sort(), [...thousandArmsEffects].sort());
  for (const history of [initial.materialDuelStats, game.materialDuelStats]) {
    assert.deepEqual([...required(history?.bot.activatedEffectIdsByMaterialId.get(221))], [thousandArmsEffects[0]]);
    assert.equal(history?.player.activatedEffectIdsByMaterialId.has(221), false);
  }
});

test("Identidade da IA distingue os efeitos ativados, mesmo com a mesma contagem", (t) => {
  const game = createGame(t);
  const material = makeCard(221, game.bot);
  game.recordMaterialEffectActivation(game.bot, material, { effectId: thousandArmsEffects[0] });
  const state = createGameTreeCopy(game).state;
  const before = fingerprintPlanningState(state);
  const ids = required(state.materialDuelStats?.bot.activatedEffectIdsByMaterialId.get(221));
  ids.clear();
  ids.add(thousandArmsEffects[1]);
  assert.notEqual(fingerprintPlanningState(state), before);
});

test("223 exige ambos os efeitos, compartilhados entre cópias e isolados por jogador", (t) => {
  const game = createGame(t);
  const material = makeCard(221, game.player);
  const otherCopy = makeCard(221, game.player);
  const malicious = makeCard(223, game.player);
  material.summonedTurn = 0;
  placeFieldCards(game.player.field, material);
  game.player.extraDeck.push(malicious);
  const legalCandidates = () => game.getAscensionCandidatesForMaterial(game.player, material)
    .filter(card => game.checkAscensionRequirements(game.player, card, material).ok);
  for (let i = 0; i < 2; i++) {
    game.recordMaterialEffectActivation(game.player, material, { effectId: thousandArmsEffects[0] });
  }
  assert.equal(game.checkAscensionRequirements(game.player, malicious, material).ok, false);
  assert.equal(legalCandidates().includes(malicious), false);
  game.recordMaterialEffectActivation(game.bot, makeCard(221, game.bot), { effectId: thousandArmsEffects[1] });
  assert.equal(game.checkAscensionRequirements(game.player, malicious, material).ok, false);
  game.turnCounter++;
  game.recordMaterialEffectActivation(game.player, otherCopy, { effectId: thousandArmsEffects[1] });
  assert.equal(game.checkAscensionRequirements(game.player, malicious, material).ok, true);
  assert.equal(legalCandidates().includes(malicious), true);
  game.resetMaterialDuelStats("test_reset");
  assert.equal(game.checkAscensionRequirements(game.player, malicious, material).ok, false);
});

test("Validador rejeita requisito de efeito ausente no material do 223", (t) => {
  const get = cardDatabaseById.get.bind(cardDatabaseById);
  t.mock.method(cardDatabaseById, "get", (id: number) => {
    const card = get(id);
    return id === 221 && card ? { ...card, effects: card.effects?.filter(e => e.id !== thousandArmsEffects[1]) } : card;
  });
  assert.ok(validateCardDatabase().errors.some(issue => issue.cardId === 223 && issue.message.includes(thousandArmsEffects[1])));
});

test("222 ainda aceita duas ativações do mesmo efeito de Walker", (t) => {
  const game = createGame(t);
  const walker = makeCard(202, game.player);
  const cosmic = makeCard(222, game.player);
  const effectId = required(walker.effects.find(e => e.timing === "ignition")).id;
  for (let i = 0; i < 2; i++) game.recordMaterialEffectActivation(game.player, walker, { effectId });
  assert.equal(game.checkAscensionRequirements(game.player, cosmic, walker).ok, true);
});

for (const disableChains of [false, true]) {
  test(`223 registra os dois efeitos reais de Mil Braços (sem Chain: ${disableChains})`, async (t) => {
    const game = createGame(t, disableChains);
    const material = makeCard(221, game.player);
    const cost = makeCard(204, game.player);
    const malicious = makeCard(223, game.player);
    game.player.hand.push(material);
    placeFieldCards(game.player.field, cost);
    assert.equal((await game.tryActivateMonsterEffect(material, { thousand_arms_cost: [cost] }, "hand", game.player, {
      effectId: thousandArmsEffects[0],
    })).success, true);
    assert.equal(game.checkAscensionRequirements(game.player, malicious, material).ok, false);
    assert.equal((await game.tryActivateMonsterEffect(material, null, "field", game.player, {
      effectId: thousandArmsEffects[1],
    })).success, true);
    assert.equal(game.checkAscensionRequirements(game.player, malicious, material).ok, true);
    assert.deepEqual([...required(game.materialDuelStats.player.activatedEffectIdsByMaterialId.get(221))].sort(), [...thousandArmsEffects].sort());
  });
}

for (const outcome of ["activation_negated", "effect_negated", "no_result"] as const) {
  test(`Histórico de efeitos distintos respeita ${outcome}`, async (t) => {
    const game = createGame(t);
    const material = makeCard(221, game.player);
    const cost = makeCard(204, game.player);
    game.player.hand.push(material);
    placeFieldCards(game.player.field, cost);
    assert.ok(game.chainSystem instanceof ChainSystem);
    const chain = game.chainSystem;
    let responded = false;
    chain.offerChainResponses = async () => {
      const link = chain.getLastChainLink();
      if (link?.effectId === thousandArmsEffects[0]) {
        responded = true;
        if (outcome === "activation_negated") chain.markChainLinkActivationNegated(link);
        if (outcome === "effect_negated") chain.markChainLinkEffectNegated(link);
        if (outcome === "no_result") await game.moveCard(material, game.player, "graveyard", { fromZone: "hand" });
      }
      return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
    };
    await game.tryActivateMonsterEffect(material, { thousand_arms_cost: [cost] }, "hand", game.player, {
      effectId: thousandArmsEffects[0],
    });
    assert.equal(responded, true);
    assert.equal(game.materialDuelStats.player.activatedEffectIdsByMaterialId?.get(221)?.has(thousandArmsEffects[0]) ?? false, outcome !== "activation_negated");
    assert.equal(game.player.field.includes(material), false);
  });
}

test("Ativação inválida de Mil Braços não registra progresso", async (t) => {
  for (const disableChains of [false, true]) {
    const game = createGame(t, disableChains);
    const material = makeCard(221, game.player);
    game.player.hand.push(material);
    const result = await game.tryActivateMonsterEffect(material, null, "hand", game.player, { effectId: thousandArmsEffects[0] });
    assert.equal(result.success, false);
    assert.equal(game.materialDuelStats.player.activatedEffectIdsByMaterialId?.has(221) ?? false, false);
  }
});

test("Cancelar a escolha do custo de Mil Braços não registra progresso", async (t) => {
  for (const disableChains of [false, true]) {
    const game = createGame(t, disableChains);
    game.player.controllerType = "human";
    const material = makeCard(221, game.player);
    const cost = makeCard(204, game.player);
    game.player.hand.push(material);
    placeFieldCards(game.player.field, cost);
    const activation = game.tryActivateMonsterEffect(material, null, "hand", game.player, { effectId: thousandArmsEffects[0] });
    for (let attempt = 0; attempt < 100 && !game.targetSelection; attempt++) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.ok(game.targetSelection);
    game.cancelTargetSelection();
    await activation;
    assert.equal(game.materialDuelStats.player.activatedEffectIdsByMaterialId.has(221), false);
    assert.equal(game.player.field.includes(cost), true);
    assert.equal(game.player.hand.includes(material), true);
  }
});

test("Falha no pagamento do custo não registra ativação de Mil Braços", async (t) => {
  for (const disableChains of [false, true]) {
    const game = createGame(t, disableChains);
    const material = makeCard(221, game.player);
    const cost = makeCard(204, game.player);
    game.player.hand.push(material);
    placeFieldCards(game.player.field, cost);
    game.setDevMode(true);
    game.devFailAfterZoneMutation = true;
    const result = await game.tryActivateMonsterEffect(material, { thousand_arms_cost: [cost] }, "hand", game.player, { effectId: thousandArmsEffects[0] });
    assert.equal(result.success, false);
    assert.equal(game.materialDuelStats.player.activatedEffectIdsByMaterialId.has(221), false);
    assert.equal(game.player.field.includes(cost), true);
    assert.equal(game.player.hand.includes(material), true);
  }
});

for (const cause of ["battle", "effect"] as const) {
  for (const atk of [0, 699, 700, 1400]) {
    test(`Hydra exige os 700 ATK completos (${cause}, ${atk} ATK)`, async (t) => {
      const game = createGame(t);
      const hydra = makeCard(215, game.player);
      hydra.atk = atk;
      placeFieldCards(game.player.field, hydra);
      game.player.controllerType = "human";
      let prompts = 0;
      game.ui.showDestructionNegationPrompt = (_name, _cost, resolve) => {
        prompts++;
        resolve(true);
      };
      const effect = required(hydra.effects.find(e => e.id === "void_hydra_titan_negate_destruction"));
      const result = await game.destroyCard(hydra, { cause });
      assert.ok("destroyed" in result);
      assert.equal(result.destroyed, atk < 700);
      assert.equal(prompts, atk < 700 ? 0 : 1);
      assert.equal(game.canUseOncePerTurn(hydra, game.player, effect).ok, atk < 700);
      if (atk >= 700) assert.equal(hydra.atk, atk - 700);
    });
  }
}

for (const change of ["negated", "declined", "negated_after_prompt", "atk_after_prompt"] as const) {
  test(`Hydra não paga proteção indisponível ou recusada (${change})`, async (t) => {
    const game = createGame(t);
    const hydra = makeCard(215, game.player);
    hydra.effectsNegated = change === "negated";
    placeFieldCards(game.player.field, hydra);
    game.player.controllerType = "human";
    let prompts = 0;
    game.ui.showDestructionNegationPrompt = (_name, _cost, resolve) => {
      prompts++;
      if (change === "negated_after_prompt") hydra.effectsNegated = true;
      if (change === "atk_after_prompt") hydra.atk = 699;
      resolve(change !== "declined");
    };
    const effect = required(hydra.effects.find(e => e.id === "void_hydra_titan_negate_destruction"));
    const result = await game.destroyCard(hydra, { cause: "effect" });
    assert.ok("destroyed" in result);
    assert.equal(result.destroyed, true);
    assert.equal(prompts, change === "negated" ? 0 : 1);
    assert.equal(game.canUseOncePerTurn(hydra, game.player, effect).ok, true);
  });
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const accept of controller === "human" ? [true, false] : [true]) {
      test(`Hydra grava a confirmação de proteção pelo broker e o playback a consome (${seat}, ${controller}, ${accept ? "aceita" : "recusa"})`, async (t) => {
        const run = async (prompt: (resolve: (value: boolean) => void) => void, decisions?: ReplayDecisionInput[]) => {
          const game = createGame(t);
          const owner = game[seat];
          owner.controllerType = controller;
          const hydra = makeCard(215, owner);
          placeFieldCards(owner.field, hydra);
          game.ui.showDestructionNegationPrompt = (_name, _cost, resolve) => prompt(resolve);
          const recorded: ReplayDecisionInput[] = [];
          game.on("decision_made", decision => { recorded.push(decision); });
          if (decisions) game.decisionBroker.loadReplayDecisions(decisions);
          const result = await game.destroyCard(hydra, { cause: "effect" });
          assert.ok("destroyed" in result);
          return { game, hydra, destroyed: result.destroyed, recorded };
        };

        let prompts = 0;
        const live = await run(resolve => { prompts++; resolve(accept); });
        assert.equal(prompts, controller === "human" ? 1 : 0, "only a human seat sees the prompt");
        assert.equal(live.destroyed, !accept);
        assert.equal(live.recorded.length, 1);
        assert.equal(live.recorded[0]?.kind, "choice");
        assert.equal(live.recorded[0]?.actorId, seat);

        const playback = await run(() => assert.fail("Playback must consume the recorded protection choice"), live.recorded);
        assert.equal(playback.destroyed, live.destroyed);
        assert.equal(playback.hydra.atk, live.hydra.atk);
        assert.equal(playback.game.decisionBroker.replayCursor, 1);
      });
    }
  }
}

test("Hydra mantém a redução e usa proteção uma vez por turno por cópia", async (t) => {
  const game = createGame(t);
  const destroy = async (card: Card, cause: "battle" | "effect") => {
    const result = await game.destroyCard(card, { cause });
    assert.ok("destroyed" in result);
    return result;
  };
  const first = makeCard(215, game.player);
  const second = makeCard(215, game.player);
  placeFieldCards(game.player.field, first, second);
  assert.equal((await destroy(first, "effect")).destroyed, false);
  assert.equal(first.atk, 3500);
  assert.equal((await destroy(second, "battle")).destroyed, false);
  assert.equal(second.atk, 3500);
  assert.equal((await destroy(first, "battle")).destroyed, true);
  game.turnCounter++;
  assert.equal((await destroy(second, "effect")).destroyed, false);
  assert.equal(second.atk, 2800);
});

test("Cavaleiro Esquecido pode enviar outra cópia face-up e se Invocar mesmo com o campo cheio", async (t) => {
  for (const disableChains of [false, true]) {
    const game = createGame(t, disableChains);
    const source = makeCard(209, game.player);
    const cost = makeCard(209, game.player);
    game.player.hand.push(source);
    placeFieldCards(
      game.player.field,
      cost,
      ...[201, 202, 203, 206].map((id) => makeCard(id, game.player)),
    );

    const result = await game.tryActivateMonsterEffect(
      source,
      { void_forgotten_knight_cost: [cost] },
      "hand",
      game.player,
      { effectId: "void_forgotten_knight_hand_summon" },
    );

    assert.equal(result.success, true);
    assert.equal(game.player.graveyard.includes(cost), true);
    assert.equal(game.player.field.includes(source), true);
    assert.equal(game.player.hand.includes(source), false);
  }
});

for (const ownerId of ["player", "bot"] as const) {
  test(`Corvo de ${ownerId} responde somente à Fusão Void do próprio jogador`, async (t) => {
    const game = createGame(t);
    const owner = game[ownerId];
    const opponent = owner === game.player ? game.bot : game.player;
    const raven = makeCard(210, owner);
    const ownFusion = makeCard(227, owner);
    const opposingFusion = makeCard(227, opponent);
    owner.hand.push(raven);
    placeFieldCards(owner.field, ownFusion);
    placeFieldCards(opponent.field, opposingFusion);

    const opposingTriggers = await game.effectEngine.collectAfterSummonTriggers({
      card: opposingFusion,
      player: opponent,
      method: "fusion",
      fromZone: "extraDeck",
    });
    assert.equal(
      opposingTriggers.entries.some((entry) => entry.card === raven),
      false,
    );
    assert.equal(owner.hand.includes(raven), true);

    const ownTriggers = await game.effectEngine.collectAfterSummonTriggers({
      card: ownFusion,
      player: owner,
      method: "fusion",
      fromZone: "extraDeck",
    });
    const entry = required(
      ownTriggers.entries.find((candidate) => candidate.card === raven),
    );
    const result = await game.runActivationPipeline(unsafeFixture<Parameters<typeof game.runActivationPipeline>[0]>(entry.config, "Collected trigger uses the concrete game cards and players behind the narrower trigger port."));

    assert.equal(result.success, true);
    assert.equal(owner.graveyard.includes(raven), true);
    assert.equal(ownFusion.immuneToOpponentEffectsUntilTurn, 3);
    assert.equal(opposingFusion.immuneToOpponentEffectsUntilTurn, null);
  });
}

test("Chifre Tenebris compartilha o limite por turno e os três usos por Duelo entre cópias", async (t) => {
  for (const disableChains of [false, true]) {
    const game = createGame(t, disableChains);
    const first = makeCard(211, game.player);
    const second = makeCard(211, game.player);
    const third = makeCard(211, game.player);
    game.player.graveyard.push(
      first,
      second,
      third,
      makeCard(204, game.player),
      makeCard(204, game.player),
    );

    const activate = (card: Card, owner = game.player) =>
      game.tryActivateMonsterEffect(card, null, "graveyard", owner, {
        effectId: "void_tenebris_horn_revive",
      });

    assert.equal((await activate(first)).success, true);
    assert.equal((await activate(second)).success, false);
    assert.equal(game.player.graveyard.includes(second), true);
    game.turnCounter += 2;
    assert.equal((await activate(second)).success, true);
    game.turnCounter += 2;
    assert.equal((await activate(third)).success, true);
    assert.equal(game.player.oncePerDuelUsageByName?.void_tenebris_horn_revive, 3);

    await game.moveCard(first, game.player, "graveyard", { fromZone: "field" });
    game.turnCounter += 2;
    assert.equal((await activate(first)).success, false);
    assert.equal(game.player.graveyard.includes(first), true);
    assert.equal(game.player.oncePerDuelUsageByName?.void_tenebris_horn_revive, 3);

    const opposingHorn = makeCard(211, game.bot);
    game.bot.graveyard.push(
      opposingHorn,
      makeCard(204, game.bot),
      makeCard(204, game.bot),
    );
    game.turn = game.bot.id;
    game.turnCounter += 1;
    assert.equal((await activate(opposingHorn, game.bot)).success, true);
    assert.equal(game.bot.field.includes(opposingHorn), true);
    assert.equal(game.bot.oncePerDuelUsageByName?.void_tenebris_horn_revive, 1);
  }
});

test("Cavaleiro bane somente a própria cópia do Cemitério antes das respostas", async (t) => {
  for (const disableChains of [false, true]) {
    const game = createGame(t, disableChains);
    const otherCopy = makeCard(209, game.player);
    const source = makeCard(209, game.player);
    const target = makeCard(217, game.bot);
    game.player.graveyard.push(otherCopy, source);
    game.bot.fieldSpell = target;
    let sourceBanishedAtResponse = false;
    if (game.chainSystem instanceof ChainSystem) {
      const chain = game.chainSystem;
      chain.offerChainResponses = async () => {
        if (chain.getLastChainLink()?.effectId === "void_forgotten_knight_gy_destroy") {
          sourceBanishedAtResponse = game.player.banished.includes(source);
          assert.equal(game.player.graveyard.includes(otherCopy), true);
          assert.equal(game.bot.fieldSpell, target);
        }
        return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
      };
    }

    const result = await game.tryActivateMonsterEffect(
      source,
      { void_forgotten_knight_gy_target: [target] },
      "graveyard",
      game.player,
      { effectId: "void_forgotten_knight_gy_destroy" },
    );

    assert.equal(result.success, true);
    assert.deepEqual(game.player.banished, [source]);
    assert.deepEqual(game.player.graveyard, [otherCopy]);
    assert.equal(game.bot.graveyard.includes(target), true);
    if (!disableChains) assert.equal(sourceBanishedAtResponse, true);
  }
});

test("Cavaleiro não paga o banimento sem Magia ou Armadilha face-up adversária", async (t) => {
  for (const disableChains of [false, true]) {
    const game = createGame(t, disableChains);
    const source = makeCard(209, game.player);
    const facedownSpell = makeCard(216, game.bot);
    facedownSpell.isFacedown = true;
    game.player.graveyard.push(source);
    placeFieldCards(game.bot.spellTrap, facedownSpell);

    const result = await game.tryActivateMonsterEffect(
      source, null, "graveyard", game.player,
      { effectId: "void_forgotten_knight_gy_destroy" },
    );

    assert.equal(result.success, false);
    assert.equal(game.player.graveyard.includes(source), true);
    assert.deepEqual(game.player.banished, []);
    assert.equal(game.bot.spellTrap.includes(facedownSpell), true);
  }
});

test("Cavaleiro mantém o custo pago sem substituir alvo que saiu durante as respostas", async (t) => {
  const game = createGame(t);
  const source = makeCard(209, game.player);
  const target = makeCard(216, game.bot);
  const replacement = makeCard(218, game.bot);
  game.player.graveyard.push(source);
  placeFieldCards(game.bot.spellTrap, target, replacement);
  assert.ok(game.chainSystem instanceof ChainSystem);
  const chain = game.chainSystem;
  let responseObserved = false;
  chain.offerChainResponses = async () => {
    if (chain.getLastChainLink()?.effectId === "void_forgotten_knight_gy_destroy") {
      responseObserved = true;
      assert.equal(game.player.banished.includes(source), true);
      const moved = await game.moveCard(target, game.bot, "hand", { fromZone: "spellTrap" });
      assert.equal(moved.success, true);
    }
    return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
  };

  await game.tryActivateMonsterEffect(
    source, { void_forgotten_knight_gy_target: [target] }, "graveyard", game.player,
    { effectId: "void_forgotten_knight_gy_destroy" },
  );

  assert.equal(responseObserved, true);
  assert.deepEqual(game.player.banished, [source]);
  assert.equal(game.bot.hand.includes(target), true);
  assert.deepEqual(game.bot.spellTrap, [replacement]);
  assert.deepEqual(game.bot.graveyard, []);
});

test("Hydra coleta seu gatilho somente na própria Invocação-Fusão", async (t) => {
  const game = createGame(t);
  const hydra = makeCard(215, game.player);
  const ownFusion = makeCard(227, game.player);
  const opposingFusion = makeCard(227, game.bot);
  placeFieldCards(game.player.field, hydra, ownFusion);
  placeFieldCards(game.bot.field, opposingFusion);
  placeFieldCards(game.bot.spellTrap, makeCard(216, game.bot));

  for (const [card, owner, method, expected] of [
    [hydra, game.player, "fusion", 1],
    [ownFusion, game.player, "fusion", 0],
    [opposingFusion, game.bot, "fusion", 0],
    [hydra, game.player, "special", 0],
  ] as const) {
    const collected = await game.effectEngine.collectAfterSummonTriggers({
      card, player: owner, method, fromZone: "extraDeck",
    });
    assert.equal(
      collected.entries.filter((entry) => entry.card === hydra).length,
      expected,
      `${card.name}, ${owner.id}, ${method}`,
    );
  }
});

for (const laterAtomicEvent of [false, true]) {
  test(`Hydra resolve obrigatoriamente e compra por destruição real (evento posterior: ${laterAtomicEvent})`, async (t) => {
    const game = createGame(t);
    const hydra = makeCard(215, game.player);
    const spell = makeCard(216, game.bot);
    const protectedSpell = makeCard(218, game.bot);
    const fieldSpell = makeCard(217, game.bot);
    protectedSpell.immuneToOpponentEffectsUntilTurn = 3;
    placeFieldCards(game.player.field, hydra);
    placeFieldCards(game.bot.spellTrap, spell, protectedSpell);
    game.bot.fieldSpell = fieldSpell;
    const draws = [makeCard(201, game.player), makeCard(202, game.player)];
    game.player.deck.push(makeCard(203, game.player), ...[...draws].reverse());
    game.player.controllerType = "human";
    let confirmations = 0;
    game.ui.showConfirmPrompt = async () => { confirmations++; return false; };
    const movements: string[] = [];
    game.on("card_moved", ({ card, fromZone, toZone }) => {
      if (card === spell || card === fieldSpell) {
        movements.push(`${card.name}:${fromZone}->${toZone}`);
        assert.equal(game.player.hand.length, 0, "A compra deve ocorrer após as destruições");
      }
    });
    assert.ok(game.chainSystem instanceof ChainSystem);
    const chain = game.chainSystem;
    chain.offerChainResponses = async () => ({
      lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0,
    });
    const occurrences = [required(chain.createTriggerOccurrence("after_summon", {
      card: hydra, player: game.player, method: "fusion", fromZone: "extraDeck",
    }))];
    if (laterAtomicEvent) {
      occurrences.push(required(chain.createTriggerOccurrence("effect_activated", {}, {
        entries: [], entriesProvided: true,
      })));
    }

    await chain.resolveTriggerOccurrences(occurrences);

    assert.equal(confirmations, 0);
    assert.deepEqual(game.bot.graveyard, [spell, fieldSpell]);
    assert.deepEqual(game.bot.spellTrap, [protectedSpell]);
    assert.equal(game.bot.fieldSpell, null);
    assert.deepEqual(game.player.hand, draws);
    assert.deepEqual(movements, [
      "Sealing the Void:spellTrap->graveyard",
      "The Void:fieldSpell->graveyard",
    ]);
  });
}

test("Berserker trigger confirmation outside the SEGOC is a recorded human choice", async (t) => {
  const run = async (prompt: (message: string) => boolean, decisions?: ReplayDecisionInput[]) => {
    const game = createGame(t, true);
    game.player.controllerType = "human";
    const berserker = makeCard(213, game.player);
    placeFieldCards(game.player.field, berserker);
    placeFieldCards(game.bot.field, makeCard(203, game.bot));
    const destroyed = makeCard(203, game.bot);
    game.bot.graveyard.push(destroyed);
    game.ui.showConfirmPrompt = async message => prompt(message);
    const recorded: ReplayDecisionInput[] = [];
    game.on("decision_made", decision => { recorded.push(decision); });
    if (decisions) game.decisionBroker.loadReplayDecisions(decisions);
    const payload = unsafeFixture<BattleDestroyEventPayload>(
      { attacker: berserker, attackerOwner: game.player, destroyed, destroyedOwner: game.bot, battleDestroyer: berserker },
      "Focused battle trigger fixture omits damage-step metadata unused by Berserker.");
    const triggers = await game.effectEngine.collectBattleDestroyTriggers(payload);
    const entry = required(triggers.entries.find(e => e.card === berserker));
    const result = await game.runActivationPipeline(unsafeFixture<Parameters<typeof game.runActivationPipeline>[0]>(entry.config,
      "Collected trigger references concrete game cards behind the narrower trigger port."));
    return { game, result, recorded };
  };

  let prompts = 0;
  const live = await run(() => { prompts++; return false; });
  assert.equal(prompts, 1);
  assert.equal(live.result.success, false, "a declined optional trigger does not resolve");
  assert.equal(live.recorded.length, 1);
  assert.equal(live.recorded[0]?.kind, "choice");

  const playback = await run(() => assert.fail("Playback must consume the recorded trigger confirmation"), live.recorded);
  assert.equal(playback.result.success, false);
  assert.equal(playback.game.decisionBroker.replayCursor, 1);
});
