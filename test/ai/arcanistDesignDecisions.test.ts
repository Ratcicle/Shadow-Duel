import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import Bot from "../../src/core/Bot.js";
import Player from "../../src/core/Player.js";
import ArcanistStrategy from "../../src/core/ai/ArcanistStrategy.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import { createCanonicalStateSnapshot } from "../../src/core/game/replay/canonical.js";
import { createPlanningCopy } from "../../src/core/ai/common/planningCopy.js";
import { summarizePlanningState } from "../../src/core/ai/common/planningDiagnostics.js";
import { getGenericHandSpellActions, getGenericIgnitionEffectActions } from "../../src/core/ai/common/actionGeneration.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import { destroySimulatedCard, replaceSimulatedBattleDestruction } from "../../src/core/ai/common/simulatedActions/destruction.js";
import { applyGenericSimulatedMainPhaseAction, emitSimulatedSpellActivation, prepareSimulatedEffectActivation, resolveSimulatedEndPhase } from "../../src/core/ai/common/simulation.js";
import { canUseSimulatedEffectUsage, markSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { moveCardToZone, appendSimulatedFieldCard } from "../../src/core/ai/common/zones.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { simulationState } from "../helpers/simulation.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import { fingerprintPlanningState } from "../../src/core/ai/common/stateFingerprint.js";
import { getTurnCardActivations } from "../../src/core/game/events/activationHistory.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";
import { executeSpellTrapEffectAction } from "../../src/core/bot/actionExecutors/spellTrap.js";
import { shouldPlaySpell } from "../../src/core/ai/arcanist/priorities.js";

const make = (id: number, owner = "bot") => createPlanningCopy().cloneCardForSim(new Card(cardDefinition(id), owner));
const strategy = () => new ArcanistStrategy(new Player("bot", "Bot"));
const equip = (host: ReturnType<typeof make>, spell = make(301)) => {
  spell.equippedTo = host; host.equips = [spell]; return spell;
};
const activeState = () => ({ turn: "bot", phase: "main1", turnCounter: 3, _isPerspectiveState: true as const });

function finalEquipScenario(actor: "player" | "bot", hostId: number, wasSet: boolean) {
  const other = actor === "bot" ? "player" : "bot";
  const host = make(hostId, actor), grimoire = make(301, actor), enemy = make(306, other);
  grimoire.isFacedown = wasSet;
  const state = simulationState({ ...activeState(), turn: actor,
    bot: { id: actor, field: [host], hand: wasSet ? [] : [grimoire], spellTrap: wasSet ? [grimoire] : [] },
    player: { id: other, field: [enemy] } });
  const ai = new ArcanistStrategy(new Player(actor, "Actor"));
  const action: AIAction = wasSet
    ? { type: "spellTrapEffect", zoneIndex: 0, cardId: 301, cardName: grimoire.name }
    : { type: "spell", index: 0, cardId: 301, cardName: grimoire.name };
  action.activationContext = { decisions: { selections: { grimoire_equip_target: [required(host.instanceId)] } } };
  return { state, host, grimoire, enemy, ai, action };
}

for (const actor of ["player", "bot"] as const) {
  test(`B26 generated Set Normal Spell stores the exact resolved source blueprint once (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0, randomSeed: 527 });
    t.after(() => game.dispose());
    const owner = Object.assign(new Bot("arcanist"), { oncePerDuelUsageByName: {} as Record<string, number> }); owner.id = actor;
    game[actor] = owner; game.turn = actor; game.phase = "main1"; game.turnCounter = 3; game.disablePresentationDelays = true;
    game.player.controllerType = game.bot.controllerType = "ai";
    game.ui.showConfirmPrompt = async () => true;
    const host = new Card(cardDefinition(306), actor), grimoire = new Card(cardDefinition(301), actor);
    const source = new Card(cardDefinition(304), actor), unrelated = new Card(cardDefinition(311), actor);
    source.isFacedown = true; source.setTurn = 1;
    grimoire.equippedTo = host; host.equips = [grimoire];
    placeFieldCards(owner.field, host); placeFieldCards(owner.spellTrap, grimoire, source, unrelated);
    placeFieldCards(game.getOpponent(owner).field, new Card(cardDefinition(306), game.getOpponent(owner).id));
    // Same-name cards in graveyard and a distinct card shifted into the source
    // index cannot replace the actual activated source for blueprint storage.
    owner.graveyard.push(new Card(cardDefinition(304), actor));
    const ai = new ArcanistStrategy(owner), state = owner.cloneGameState(
      unsafeFixture<Parameters<Bot["cloneGameState"]>[0]>(game, "Concrete game fixture supplies the verified Bot clone port."));
    const simSource = required(state.bot.spellTrap.find(card => card.instanceId === source.instanceId));
    const storageSources: Parameters<ArcanistStrategy["simulateArcanistBlueprintStorage"]>[1][] = [];
    const store = ai.simulateArcanistBlueprintStorage.bind(ai);
    ai.simulateArcanistBlueprintStorage = (simState, resolvedSource) => { storageSources.push(resolvedSource); store(simState, resolvedSource); };
    const action = required(ai.generateMainPhaseActions(game).find(action => action.type === "spellTrapEffect" && action.cardId === 304));
    if (action.type !== "spellTrapEffect") assert.fail("Expected Set Spell activation");
    const simAction = required(ai.generateMainPhaseActions(state).find(action => action.type === "spellTrapEffect" && action.cardId === 304));
    assert.equal(action.effectId, "lightning_magic_lance_effect");
    ai.simulateMainPhaseAction(state, simAction);
    assert.equal(await executeSpellTrapEffectAction(owner,
      unsafeFixture<Parameters<typeof executeSpellTrapEffectAction>[1]>(game, "Concrete game fixture supplies the verified Bot executor port."), action), true);
    const liveBlueprints = game.effectEngine.getStoredBlueprints(grimoire);
    const simGrimoire = required(state.bot.spellTrap.find(card => card.instanceId === grimoire.instanceId));
    assert.deepEqual(liveBlueprints.map(entry => entry.sourceCardId), [304]);
    assert.deepEqual(simGrimoire.state?.blueprintStorage?.storedBlueprints.map(entry => entry.sourceCardId), [304]);
    assert.deepEqual(storageSources, [simSource]);
    assert.ok(state.bot.graveyard.includes(simSource));
    assert.ok(owner.graveyard.includes(source));
    assert.equal(state.bot.spellTrap[1]?.instanceId, unrelated.instanceId);
    assert.equal(state.bot.field[0]?.atk, host.atk);
    assert.equal(state.bot.spellTrap.find(card => card.instanceId === unrelated.instanceId)?.counters?.get("ink") || 0,
      unrelated.counters.get("ink") || 0, "Ink River observes the captured Normal Spell, even after its source slot shifts");
    assert.deepEqual(state._simUnsupportedActions || [], []);
    const faceup = required(ai.generateMainPhaseActions(state).find(entry => entry.type === "spellTrapEffect" && entry.cardId === 301));
    ai.simulateMainPhaseAction(state, faceup);
    assert.deepEqual(storageSources, [simSource], "face-up stored-effect Ignition is not a new Spell card activation");
  });

  test(`B26 rejected Set Spell activation case never stores a blueprint (${actor})`, () => {
    const host = make(306, actor), source = make(304, actor), grimoire = equip(host, make(301, actor));
    source.isFacedown = true; source.setTurn = 1;
    source.effects = [{ id: "unpayable_set_case", timing: "on_play", storableByGrimoire: true,
      activationCases: [{ id: "expensive", activationCosts: [{ type: "pay_lp", amount: 9000 }], actions: [{ type: "heal", amount: 100 }] }] }];
    const state = simulationState({ ...activeState(), turn: actor, bot: { id: actor, field: [host], spellTrap: [grimoire, source] },
      player: { id: actor === "bot" ? "player" : "bot" } });
    const ai = new ArcanistStrategy(new Player(actor, "Actor"));
    const before = fingerprintPlanningState(state);
    ai.simulateMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 1, cardId: 304, effectId: "unpayable_set_case",
      activationContext: { decisions: { cases: { unpayable_set_case: "expensive" } } } });
    assert.equal(grimoire.state?.blueprintStorage?.storedBlueprints.length || 0, 0);
    assert.equal(state.bot.lp, 8000);
    assert.equal(getTurnCardActivations(state).length, 0);
    assert.equal(source.isFacedown, true);
    assert.equal(fingerprintPlanningState(state), before);
  });

  test(`B26 generated Set Grimoire agrees with preview, Bot executor and simulation (${actor})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0, randomSeed: 526 });
    t.after(() => game.dispose());
    const owner = Object.assign(new Bot("arcanist"), { oncePerDuelUsageByName: {} as Record<string, number> }); owner.id = actor;
    game[actor] = owner;
    game.turn = actor; game.phase = "main1"; game.turnCounter = 3; game.disablePresentationDelays = true;
    game.player.controllerType = game.bot.controllerType = "ai";
    const source = new Card(cardDefinition(301), actor), host = new Card(cardDefinition(306), actor);
    source.isFacedown = true; source.setTurn = 1;
    placeFieldCards(owner.field, host); placeFieldCards(owner.spellTrap, source);
    const ai = new ArcanistStrategy(owner), state = owner.cloneGameState(
      unsafeFixture<Parameters<Bot["cloneGameState"]>[0]>(game,
        "Concrete runtime fixture supplies Bot's clone port; its EffectEngine facade does not declare the legacy optional usage map."));
    const generated = required(ai.generateMainPhaseActions(game).find(action => action.type === "spellTrapEffect" && action.cardId === 301));
    assert.equal(generated.type, "spellTrapEffect");
    if (generated.type !== "spellTrapEffect") assert.fail("Expected Set Spell activation");
    assert.equal(generated.effectId, "arcanist_grimoire_equip");
    assert.equal(generated.activationContext?.effectId, "arcanist_grimoire_equip");
    assert.equal(generated.priority, shouldPlaySpell(source, ai.analyzeGameState(game)).priority);
    assert.equal(game.effectEngine.canActivateSpellTrapEffectPreview(source, owner, "spellTrap", null,
      { activationContext: generated.activationContext }).ok, true);
    const simulatedAction = required(ai.generateMainPhaseActions(state).find(action => action.type === "spellTrapEffect" && action.cardId === 301));
    assert.equal(simulatedAction.effectId, generated.effectId);
    ai.simulateMainPhaseAction(state, simulatedAction);
    assert.equal(await executeSpellTrapEffectAction(owner,
      unsafeFixture<Parameters<typeof executeSpellTrapEffectAction>[1]>(game,
        "Concrete runtime fixture implements the Bot executor port; preview reasons also permit explicit undefined in the engine facade."), generated), true);
    const simulatedSource = required(state.bot.spellTrap.find(card => card.instanceId === source.instanceId));
    assert.equal(source.equippedTo, host);
    assert.equal(simulatedSource.equippedTo?.instanceId, host.instanceId);
    assert.equal(simulatedSource.isFacedown, source.isFacedown);
    assert.equal(getTurnCardActivations(game).length, 1);
    assert.equal(getTurnCardActivations(state).length, 1);
    assert.equal(ai.generateMainPhaseActions(game).some(action => action.type === "spellTrapEffect" && action.cardId === 301), false,
      "face-up Grimoire with no stored blueprint preserves the Ignition policy");
    assert.deepEqual(state._simUnsupportedActions || [], []);
  });

  for (const gate of ["new_set", "no_host", "faceup", "negated", "other_set", "opponent", "full"] as const) {
    test(`B26 Arcanist Set generation preserves ${gate} gate (${actor})`, () => {
      const { state, host, grimoire, ai } = finalEquipScenario(actor, 306, true);
      grimoire.setTurn = gate === "new_set" ? state.turnCounter : 1;
      if (gate === "no_host") state.bot.field = [];
      if (gate === "faceup" || gate === "negated" || gate === "other_set" || gate === "opponent") {
        const first = make(301, gate === "opponent" ? state.player.id : actor);
        first.isFacedown = gate === "other_set"; first.effectsNegated = gate === "negated";
        if (!first.isFacedown) first.equippedTo = host;
        appendSimulatedFieldCard(gate === "opponent" ? state.player.spellTrap : state.bot.spellTrap, first);
      }
      if (gate === "full") while (state.bot.spellTrap.length < 5) appendSimulatedFieldCard(state.bot.spellTrap, make(309, actor));
      const blocked = ["new_set", "no_host", "faceup", "negated"].some(value => value === gate);
      assert.equal(ai.generateMainPhaseActions(state).some(action => action.type === "spellTrapEffect" && action.cardId === 301
        && action.zoneIndex === 0 && action.effectId === "arcanist_grimoire_equip"), !blocked);
    });
  }
}

for (const actor of ["player", "bot"] as const) {
  for (const wasSet of [false, true]) {
    const route = wasSet ? "set" : "hand";
    test(`B25 equip halves after the Spell debuff and fully expires (${actor}/${route})`, () => {
      const { state, host, grimoire, enemy, ai, action } = finalEquipScenario(actor, 314, wasSet);
      const beforeEquip: number[][] = [];
      const original = ai.simulateArcanistOnEquipTriggers.bind(ai);
      ai.simulateArcanistOnEquipTriggers = (...args) => { beforeEquip.push([required(enemy.atk), required(enemy.def)]); original(...args); };
      assert.deepEqual([enemy.atk, enemy.def], [1500, 1800]);
      ai.simulateMainPhaseAction(state, action);
      assert.deepEqual(beforeEquip, [[1400, 1700]]);
      assert.equal(grimoire.equippedTo, host);
      assert.deepEqual([enemy.atk, enemy.def], [700, 850]);
      assert.equal(getTurnCardActivations(state).length, 1);
      const effect = required(host.effects?.find(effect => effect.id === "azrath_equip_halve"));
      assert.equal(canUseSimulatedEffectUsage(state, effect, host, actor, true), false);
      resolveSimulatedEndPhase(state);
      assert.deepEqual([enemy.atk, enemy.def], [1500, 1800]);
      resolveSimulatedEndPhase(state);
      assert.deepEqual([enemy.atk, enemy.def], [1500, 1800]);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });

    for (const change of ["odd", "other_modifiers", "source_exit", "target_exit"] as const) {
      test(`B25 temporary half preserves ${change} lifecycle (${actor}/${route})`, () => {
        const { state, host, enemy, ai, action } = finalEquipScenario(actor, 314, wasSet);
        if (change === "odd") { enemy.baseAtk = enemy.atk = 1501; enemy.baseDef = enemy.def = 1801; }
        const permanent = (atkBoost: number, defBoost: number, sourceName: string) => applySimulatedActions({ state, selfId: "player",
          actions: [{ type: "permanent_buff_named", targetRef: "target", atkBoost, defBoost, sourceName }],
          selections: { target: [enemy] }, options: { sourceCard: make(304, state.player.id) } });
        if (change === "other_modifiers") permanent(333, 177, "before_half");
        const before = [required(enemy.atk), required(enemy.def)];
        ai.simulateMainPhaseAction(state, action);
        assert.deepEqual([enemy.atk, enemy.def], before.map(value => Math.floor((value - 100) / 2)));
        if (change === "other_modifiers") {
          permanent(77, 33, "after_half");
          applySimulatedActions({ state, selfId: "player", selections: { target: [enemy] },
            actions: [{ type: "buff_stats_temp", targetRef: "target", atkBoost: 101, defBoost: 51, duration: "end_of_turn" }] });
        }
        if (change === "source_exit") {
          moveCardToZone(state.bot, host, "graveyard", state.bot, { state });
          assert.deepEqual([enemy.atk, enemy.def], before.map(value => Math.floor((value - 100) / 2)));
        }
        if (change === "target_exit") {
          moveCardToZone(state.player, enemy, "hand", state.player, { state });
          assert.deepEqual([enemy.atk, enemy.def], before);
          moveCardToZone(state.player, enemy, "field", state.player, { state });
        }
        resolveSimulatedEndPhase(state);
        assert.deepEqual([enemy.atk, enemy.def], change === "other_modifiers"
          ? [required(before[0]) + 77, required(before[1]) + 33] : before);
        assert.deepEqual(state._simUnsupportedActions || [], []);
      });
    }

    test(`B21 recovers the preferred Spell from another archetype (${actor}/${route})`, () => {
      const { state, host, ai, action } = finalEquipScenario(actor, 305, wasSet);
      const chosen = make(276, actor), arcanistSpell = make(310, actor), monster = make(306, actor);
      const trap = make(276, actor); trap.cardKind = "trap";
      state.bot.graveyard.push(arcanistSpell, chosen, monster, trap);
      action.activationContext = { decisions: { selections: {
        grimoire_equip_target: [required(host.instanceId)], viridis_recover_target: [required(chosen.instanceId)],
      } }, actionContext: { targetPreferences: { viridis_recover_target: { preferredInstanceIds: [required(chosen.instanceId)] } } } };
      ai.simulateMainPhaseAction(state, action);
      assert.ok(state.bot.hand.includes(chosen));
      assert.deepEqual(state.bot.graveyard, [arcanistSpell, monster, trap]);
      assert.equal(canUseSimulatedEffectUsage(state, required(host.effects?.find(effect => effect.id === "viridis_arcanist_life_recover")), host, actor, true), false);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });

    for (const context of ["root", "nested", "both"] as const) {
      test(`B21 preference-only recovery preserves ${context} context precedence (${actor}/${route})`, () => {
        const { state, ai, action } = finalEquipScenario(actor, 305, wasSet);
        const first = make(310, actor), chosen = make(310, actor);
        state.bot.graveyard.push(first, chosen);
        const preferences = { viridis_recover_target: { preferredInstanceIds: [required(chosen.instanceId)] } };
        action.activationContext = context === "root" ? { targetPreferences: preferences }
          : context === "nested" ? { actionContext: { targetPreferences: preferences } }
          : { targetPreferences: { viridis_recover_target: { preferredInstanceIds: [required(first.instanceId)] } },
            actionContext: { targetPreferences: preferences } };
        ai.simulateMainPhaseAction(state, action);
        assert.ok(state.bot.hand.includes(chosen), "preferences work without exact decision selections");
        assert.ok(state.bot.graveyard.includes(first));
      });
    }

    test(`B20 preference-only Grimoire equip preserves root host choice (${actor}/${route})`, () => {
      const { state, host, grimoire, enemy, ai, action } = finalEquipScenario(actor, 305, wasSet);
      const chosenHost = make(314, actor); appendSimulatedFieldCard(state.bot.field, chosenHost);
      action.activationContext = { targetPreferences: {
        grimoire_equip_target: { preferredInstanceIds: [required(host.instanceId)] },
      } };
      ai.simulateMainPhaseAction(state, action);
      assert.equal(grimoire.equippedTo, host);
      assert.deepEqual(chosenHost.equips, []);
      assert.deepEqual([enemy.atk, enemy.def], [1400, 1700]);
    });

    test(`B21 caller host preference preserves computed recovery preferences (${actor}/${route})`, () => {
      const { state, host, ai, action } = finalEquipScenario(actor, 305, wasSet);
      const otherSpell = make(276, actor), preferredSpell = make(310, actor);
      state.bot.graveyard.push(otherSpell, preferredSpell);
      action.activationContext = { actionContext: { targetPreferences: {
        grimoire_equip_target: { preferredInstanceIds: [required(host.instanceId)] },
      } } };
      ai.simulateMainPhaseAction(state, action);
      assert.ok(state.bot.hand.includes(preferredSpell));
      assert.ok(state.bot.graveyard.includes(otherSpell));
    });

    for (const id of [305, 307, 308, 314]) {
      test(`final equip interpreter preserves target identity and hard OPT (${actor}/${route}/${id})`, () => {
        const { state, host, grimoire, enemy, ai, action } = finalEquipScenario(actor, id, wasSet);
        const target = make(id === 305 ? 276 : 306, actor);
        state.bot.graveyard.push(target);
        ai.simulateMainPhaseAction(state, action);
        const effect = required(host.effects?.find(effect => effect.event === "card_equipped"));
        if (id === 305 || id === 307) assert.ok(state.bot.hand.includes(target));
        if (id === 308) assert.ok(state.bot.field.includes(target));
        if (id === 314) assert.equal(enemy.atk, 700);
        assert.equal(canUseSimulatedEffectUsage(state, effect, host, actor, true), false);
        const before = fingerprintPlanningState(state);
        ai.simulateArcanistOnEquipTriggers(state, host, grimoire, action);
        assert.equal(fingerprintPlanningState(state), before, "the same equipment notification cannot grant a second use");
        resolveSimulatedEndPhase(state);
        state.turnCounter++;
        assert.equal(canUseSimulatedEffectUsage(state, effect, host, actor, true), true);
        if (id !== 314) moveCardToZone(state.bot, target, "graveyard", state.bot, { state });
        ai.simulateArcanistOnEquipTriggers(state, host, grimoire, action);
        assert.equal(canUseSimulatedEffectUsage(state, effect, host, actor, true), false);
        if (id === 305 || id === 307) assert.ok(state.bot.hand.includes(target));
        if (id === 308) assert.ok(state.bot.field.includes(target));
        if (id === 314) assert.equal(enemy.atk, 750, "next turn has no new Spell activation and halves the restored ATK");
        assert.deepEqual(state._simUnsupportedActions || [], []);
      });
    }

    for (const blocked of ["active", "negated", "no_host", "full"] as const) {
      if (wasSet && blocked === "full") continue;
      test(`B20 rejects injected Grimoire activation without mutation: ${blocked} (${actor}/${route})`, () => {
        const { state, grimoire, host, ai, action } = finalEquipScenario(actor, 305, wasSet);
        const river = make(311, actor); river.counters = new Map([["ink", 2]]);
        appendSimulatedFieldCard(state.bot.spellTrap, river);
        if (blocked === "active" || blocked === "negated") {
          const first = make(301, actor); first.effectsNegated = blocked === "negated";
          first.equippedTo = host; host.equips = [first]; appendSimulatedFieldCard(state.bot.spellTrap, first);
        }
        if (blocked === "no_host") state.bot.field = [];
        if (blocked === "full") {
          while (state.bot.spellTrap.length < 5) appendSimulatedFieldCard(state.bot.spellTrap, make(309, actor));
        }
        const before = fingerprintPlanningState(state), row = state.bot.spellTrap.slice(), hand = state.bot.hand.slice();
        ai.simulateMainPhaseAction(state, action);
        assert.equal(fingerprintPlanningState(state), before);
        assert.deepEqual(state.bot.spellTrap, row); assert.deepEqual(state.bot.hand, hand);
        assert.equal(grimoire.isFacedown, wasSet);
        assert.equal(grimoire.equippedTo, null);
        assert.equal(getTurnCardActivations(state).length, 0);
        assert.equal(river.counters.get("ink"), 2);
      });
    }

    for (const existing of ["none", "facedown", "opponent", ...(wasSet ? ["full" as const] : [])]) {
      test(`B20 accepts a legal Grimoire activation: ${existing} (${actor}/${route})`, () => {
        const { state, host, grimoire, ai, action } = finalEquipScenario(actor, 305, wasSet);
        if (existing === "full") {
          while (state.bot.spellTrap.length < 5) appendSimulatedFieldCard(state.bot.spellTrap, make(309, actor));
        } else if (existing !== "none") {
          const first = make(301, existing === "opponent" ? state.player.id : actor);
          first.isFacedown = existing === "facedown";
          appendSimulatedFieldCard(existing === "opponent" ? state.player.spellTrap : state.bot.spellTrap, first);
        }
        ai.simulateMainPhaseAction(state, action);
        assert.equal(grimoire.equippedTo, host); assert.deepEqual(host.equips, [grimoire]);
        assert.equal(grimoire.isFacedown, false);
        assert.equal(getTurnCardActivations(state).length, 1);
        assert.deepEqual(state._simUnsupportedActions || [], []);
      });
    }
  }

  for (const existing of [false, true]) {
    test(`B20 set Grimoire resolves the branch slot despite pre-clone card metadata (${actor}/${existing ? "duplicate" : "valid"})`, () => {
      const { state, host, grimoire, enemy, ai, action } = finalEquipScenario(actor, 314, true);
      action.card = createPlanningCopy().cloneCardForSim(grimoire);
      assert.notEqual(action.card, grimoire);
      if (existing) appendSimulatedFieldCard(state.bot.spellTrap, make(301, actor));
      const before = fingerprintPlanningState(state);
      ai.simulateMainPhaseAction(state, action);
      if (existing) {
        assert.equal(fingerprintPlanningState(state), before);
        assert.equal(grimoire.isFacedown, true);
        assert.equal(grimoire.equippedTo, null);
        assert.deepEqual([enemy.atk, enemy.def], [1500, 1800]);
      } else {
        assert.equal(grimoire.isFacedown, false);
        assert.equal(grimoire.equippedTo, host);
        assert.deepEqual([enemy.atk, enemy.def], [700, 850]);
        assert.equal(canUseSimulatedEffectUsage(state,
          required(host.effects?.find(effect => effect.id === "azrath_equip_halve")), host, actor, true), false);
      }
    });
  }

  test(`B21 missing eligible targets preserve the next equip recovery (${actor})`, () => {
    const { state, host, grimoire, ai, action } = finalEquipScenario(actor, 305, false);
    const monster = make(306, actor), trap = make(276, actor); trap.cardKind = "trap";
    state.bot.graveyard.push(monster, trap);
    ai.simulateMainPhaseAction(state, action);
    const effect = required(host.effects?.find(effect => effect.id === "viridis_arcanist_life_recover"));
    assert.equal(canUseSimulatedEffectUsage(state, effect, host, actor, true), true);
    const spell = make(276, actor); state.bot.graveyard.push(spell);
    ai.simulateArcanistOnEquipTriggers(state, host, grimoire, action);
    assert.ok(state.bot.hand.includes(spell));
    assert.equal(canUseSimulatedEffectUsage(state, effect, host, actor, true), false);
    assert.ok(state.bot.graveyard.includes(monster)); assert.ok(state.bot.graveyard.includes(trap));
  });
}

for (const seat of ["player", "bot"] as const) {
  for (const id of [307, 314]) {
    test(`B08/B19 simulated Equip activation resolves the imperative trigger (${seat}/${id})`, () => {
      const other = seat === "bot" ? "player" : "bot", host = make(id, seat), equip = make(301, seat);
      const target = make(306, id === 307 ? seat : other);
      const state = simulationState({ ...activeState(), turn: seat,
        bot: { id: seat, field: [host], hand: [equip], graveyard: id === 307 ? [target] : [] },
        player: { id: other, field: id === 314 ? [target] : [] } });
      new ArcanistStrategy(new Player(seat, "Actor")).simulateMainPhaseAction(state,
        { type: "spell", index: 0, cardId: 301, cardName: equip.name });
      assert.equal(equip.equippedTo, host);
      if (id === 307) { assert.ok(state.bot.hand.includes(target)); assert.equal(state.bot.graveyard.includes(target), false); }
      else assert.deepEqual([target.atk, target.def], [Math.floor((required(target.baseAtk) - 100) / 2), Math.floor((required(target.baseDef) - 100) / 2)]);
      assert.deepEqual(state._simUnsupportedActions || [], []);
    });
  }

  test(`B17 simulation counts earlier activations and refreshes each Elementalist presence (${seat})`, () => {
    const other = seat === "bot" ? "player" : "bot";
    const source = make(313, seat);
    const state = simulationState({ ...activeState(), turn: seat,
      bot: { id: seat, hand: [source] }, player: { id: other } });
    emitSimulatedSpellActivation(state, make(310, seat));
    emitSimulatedSpellActivation(state, make(304, other), "player");
    emitSimulatedSpellActivation(state, make(3, seat));
    moveCardToZone(state.bot, source, "field", state.bot, { state });
    const ai = new ArcanistStrategy(new Player(seat, "Actor"));
    ai.applySimulatedArcanistPassiveStats(state);
    assert.equal(source.atk, required(source.baseAtk) + 200);
    ai.applySimulatedArcanistPassiveStats(state);
    assert.equal(source.atk, required(source.baseAtk) + 200, "refresh cannot grant the same contribution twice");
    source.effectsNegated = true;
    ai.applySimulatedArcanistPassiveStats(state);
    assert.equal(source.atk, source.baseAtk);
    source.effectsNegated = false;
    source.isFacedown = true;
    ai.applySimulatedArcanistPassiveStats(state);
    assert.equal(source.atk, source.baseAtk);
    source.isFacedown = false;
    ai.applySimulatedArcanistPassiveStats(state);
    assert.equal(source.atk, required(source.baseAtk) + 200);
    moveCardToZone(state.bot, source, "hand", state.bot, { state });
    assert.equal(source.atk, source.baseAtk, "the continuous contribution must cease outside the field");
    emitSimulatedSpellActivation(state, make(301, seat));
    moveCardToZone(state.bot, source, "field", state.bot, { state });
    assert.equal(source.atk, required(source.baseAtk) + 300);
    resolveSimulatedEndPhase(state);
    assert.equal(source.atk, source.baseAtk);
  });
}

for (const seat of ["player", "bot"] as const) {
  for (const id of [303, 313]) {
    test(`B06/B16 generic AI generation and execution accept ${id} against a face-down opponent (${seat})`, () => {
      const opponentSeat = seat === "bot" ? "player" : "bot";
      const source = make(id, seat), ally = make(306, seat), enemy = make(306, opponentSeat);
      enemy.isFacedown = true;
      enemy.position = "defense";
      const grimoire = id === 313 ? equip(source, make(301, seat)) : make(301, seat);
      const state = simulationState({ ...activeState(), turn: seat,
        bot: { id: seat, field: id === 303 ? [ally] : [source], hand: id === 303 ? [source] : [],
          spellTrap: id === 313 ? [grimoire] : [] },
        player: { id: opponentSeat, field: [enemy] } });
      const ai = new ArcanistStrategy(new Player(seat, "Actor"));
      const publicBefore = summarizePlanningState(state, { bot: { id: seat } });
      const hidden = required(publicBefore.opponent.field[0]);
      assert.equal(hidden.name, "unknown");
      assert.deepEqual([hidden.atk, hidden.def], [0, 0]);
      assert.equal(hidden.kind, "monster");
      // Exercise declarative legality independently of the strategy's existing
      // preferences for face-up threats and favorable Crimson trades.
      const effect = required(source.effects?.find(entry => entry.id === (id === 303 ? "crimson_magic_explosion_effect" : "elementalist_master_destroy")));
      const canActivate = () => prepareSimulatedEffectActivation(state, source, effect) !== null;
      const actions = id === 303
        ? getGenericHandSpellActions({ game: state, player: state.bot, canActivate })
        : getGenericIgnitionEffectActions({ game: state, player: state.bot, cards: state.bot.field,
          type: "monsterEffect", sourceZone: "field", indexFields: ["fieldIndex"],
          findEffect: () => effect, canActivate });
      const action = required(actions.find(candidate =>
        candidate.type === (id === 303 ? "spell" : "monsterEffect") && candidate.cardId === id),
      "face-down monsters must be legal destruction targets");
      assert.deepEqual(summarizePlanningState(state, { bot: { id: seat } }), publicBefore,
        "discovering the legal action must preserve the public masking of its target");
      const before = { own: ally.atk, opponent: enemy.atk };
      ai.simulateMainPhaseAction(state, action);
      assert.ok(state.player.graveyard.includes(enemy));
      assert.equal(state.player.field.includes(enemy), false);
      assert.deepEqual(state._simUnsupportedActions || [], []);
      assert.equal(state.player.lp, id === 303 ? 8000 - Math.floor(required(before.opponent) / 2) : 8000);
      if (id === 303) {
        assert.ok(state.bot.graveyard.some(card => card.instanceId === source.instanceId));
        assert.ok(state.bot.graveyard.includes(ally));
        assert.equal(state.bot.lp, 8000 - Math.floor(required(before.own) / 2));
      } else {
        assert.ok(state.bot.field.includes(source));
        assert.equal(canUseSimulatedEffectUsage(state, required(source.effects?.find(effect => effect.id === "elementalist_master_destroy")), source), false);
      }
    });
  }
}

test("301 copies costs and targets while retaining only its own per-copy usage", () => {
  const host = make(302); const grimoire = equip(host); const cost = make(301);
  // A synthetic second Equip isolates copied payment while the source remains.
  cost.name = "Synthetic Arcanist Equip";
  const enemy = make(307, "player"); const original = make(316);
  const state = simulationState({ ...activeState(), bot: { field: [host], spellTrap: [grimoire, cost] }, player: { field: [enemy] } });
  const ai = strategy(); ai.simulateArcanistBlueprintStorage(state, original);
  markSimulatedEffectUsage(state, required(original.effects?.[0]), original, "bot");
  ai.simulateMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, cardId: 301, cardName: grimoire.name,
    activationContext: { decisions: { selections: {
      seismic_impact_equip_cost: [required(cost.instanceId)], seismic_impact_target: [required(enemy.instanceId)],
    } } } });
  assert.ok(state.bot.graveyard.includes(cost)); assert.ok(state.player.banished.includes(enemy));
  assert.ok(state.bot.spellTrap.includes(grimoire));
  assert.equal(canUseSimulatedEffectUsage(state, required(grimoire.effects?.find(effect => effect.timing === "ignition")), grimoire), false);
  assert.deepEqual(state._simUnsupportedActions || [], []);
});

test("301 self-payment is legal but its copied effect fizzles after its Equip source leaves", () => {
  const host = make(302); const grimoire = equip(host); const enemy = make(307, "player");
  const state = simulationState({ ...activeState(), bot: { field: [host], spellTrap: [grimoire] }, player: { field: [enemy] } });
  const ai = strategy(); ai.simulateArcanistBlueprintStorage(state, make(316));
  ai.simulateMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, cardId: 301, cardName: grimoire.name });
  assert.ok(state.bot.graveyard.includes(grimoire)); assert.ok(state.player.field.includes(enemy));
  assert.equal(state.player.banished.length, 0);
});

test("301 copies 310 after the original limit was used and never emits another Spell activation", () => {
  const host = make(314); const grimoire = equip(host); const enemy = make(307, "player"); const original = make(310);
  const state = simulationState({ ...activeState(), bot: { field: [host], spellTrap: [grimoire], deck: [make(302), make(307)] }, player: { field: [enemy] } });
  const ai = strategy(); ai.simulateArcanistBlueprintStorage(state, original);
  markSimulatedEffectUsage(state, required(original.effects?.[0]), original, "bot");
  ai.simulateMainPhaseAction(state, { type: "spellTrapEffect", zoneIndex: 0, cardId: 301, cardName: grimoire.name });
  assert.equal(state.bot.hand.length, 2); assert.equal(enemy.atk, enemy.baseAtk);
  assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), false);
});

test("302 aura suspends with source negation and resumes without a second grant", () => {
  const apprentice = make(302); const ally = make(307); const grimoire = equip(apprentice);
  const state = simulationState({ ...activeState(), bot: { field: [apprentice, ally], spellTrap: [grimoire] } });
  const ai = strategy();
  ai.applySimulatedArcanistPassiveStats(state);
  assert.equal(ally.atk, required(ally.baseAtk) + 300);
  apprentice.effectsNegated = true;
  ai.applySimulatedArcanistPassiveStats(state);
  assert.equal(ally.atk, ally.baseAtk);
  apprentice.effectsNegated = false;
  ai.applySimulatedArcanistPassiveStats(state);
  assert.equal(ally.atk, required(ally.baseAtk) + 300);
});

test("303 captures ATK immediately before each sequential destruction", () => {
  const first = make(302); const second = make(307, "player");
  const state = simulationState({ ...activeState(), bot: { field: [first] }, player: { field: [second] } });
  applySimulatedActions({ state, actions: [{ type: "destroy_and_damage_by_target_atk", entries: [
    { targetRef: "first", multiplier: 0.5 }, { targetRef: "second", multiplier: 0.5 },
  ] }], selections: { first: [first], second: [second] }, options: {
    sourceCard: make(303), emitSimulatedEvent: (event) => {
      if (event === "card_moved" && state.bot.graveyard.includes(first)) second.atk = 200;
    },
  } });
  assert.equal(state.bot.lp, 7250);
  assert.equal(state.player.lp, 7900);
});

test("304 attack bonus and piercing expire at the end of this turn", () => {
  const host = make(302); const spell = make(304);
  const state = simulationState({ ...activeState(), bot: { field: [host], hand: [spell] } });
  strategy().simulateMainPhaseAction(state, { type: "spell", cardId: 304, cardName: spell.name, index: 0 });
  assert.equal(host.atk, required(host.baseAtk) + 500); assert.equal(host.piercing, true);
  resolveSimulatedEndPhase(state);
  assert.equal(host.atk, host.baseAtk); assert.equal(host.piercing, false);
});

test("307 uses a costless hand summon procedure with its own hard limit", () => {
  const host = make(302); const albus = make(307); const second = make(307);
  const state = simulationState({ ...activeState(), bot: { field: [host], hand: [albus, second] } });
  const perform = () => applyGenericSimulatedMainPhaseAction(state, { type: "handSummonProcedure", index: 0,
    cardId: 307, materials: [], position: "defense" });
  perform(); perform();
  assert.equal(state.bot.field.length, 2); assert.equal(state.bot.hand.length, 1);
  assert.equal(state.bot.field[1]?.position, "defense");
  assert.equal(state.bot.field[1]?.lastSummonProcedure, albus.handSummonProcedure?.id);
  assert.deepEqual(state._simUnsupportedActions || [], []);
});

test("301 cannot store a resolved Spell while its effects are negated", () => {
  const host = make(302); const grimoire = equip(host); const spell = make(304);
  grimoire.effectsNegated = true;
  const state = simulationState({ ...activeState(), bot: { field: [host], spellTrap: [grimoire], hand: [spell] } });
  strategy().simulateMainPhaseAction(state, { type: "spell", cardId: 304, cardName: spell.name, index: 0 });
  assert.equal(grimoire.state?.blueprintStorage?.storedBlueprints?.length || 0, 0);
});

test("Arcanist candidates use the new Albus procedure and Elementalist ignition", () => {
  const host = make(313); const albus = make(307); const grimoire = equip(host); const enemy = make(302, "player");
  const state = simulationState({ ...activeState(), bot: { field: [host], hand: [albus], spellTrap: [grimoire] }, player: { field: [enemy] } });
  const ai = strategy(); const actions = ai.generateMainPhaseActions(state);
  assert.ok(actions.some(action => action.type === "handSummonProcedure" && action.cardId === 307));
  assert.equal(actions.some(action => action.type === "handIgnition" && action.cardId === 307), false);
  assert.ok(actions.some(action => action.type === "monsterEffect" && action.cardId === 313));
});

test("309 each copy can prevent one spell destruction independently", () => {
  const first = make(309); const second = make(309); const target = make(311);
  const state = simulationState({ ...activeState(), bot: { spellTrap: [first, second, target] } });
  assert.equal(destroySimulatedCard(target, state.bot, state.player, state, {}), false);
  assert.equal(destroySimulatedCard(target, state.bot, state.player, state, {}), false);
  assert.equal(destroySimulatedCard(target, state.bot, state.player, state, {}), true);
});

test("310 protects only its target once across battle and effects and draws two when equipped", () => {
  const host = make(302); const ally = make(307); const grimoire = equip(host); const spell = make(310);
  const state = simulationState({ ...activeState(), bot: { field: [host, ally], spellTrap: [grimoire], hand: [spell], deck: [make(304), make(303)] } });
  strategy().simulateMainPhaseAction(state, { type: "spell", cardId: 310, cardName: spell.name, index: 0,
    activationContext: { decisions: { selections: { arcanist_ice_barrier_target: [required(host.instanceId)] } } } });
  assert.equal(state.bot.hand.length, 2);
  assert.equal(destroySimulatedCard(ally, state.bot, state.player, state, {}), true);
  assert.ok(replaceSimulatedBattleDestruction(state, host));
  assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), true);
});

test("310 replacement expires after next turn and never follows a new presence", () => {
  for (const leave of [false, true]) {
    const host = make(302); const state = simulationState({ ...activeState(), bot: { field: [host] } });
    applySimulatedActions({ state, selections: { target: [host] }, options: { sourceCard: make(310) }, actions: [{
      type: "register_replacement_effect", targetRef: "target", uses: 1, duration: "end_of_next_turn",
      replacementEffect: { type: "destruction", reason: "any", targetZones: ["field"] },
    }] });
    if (leave) { moveCardToZone(state.bot, host, "hand", state.bot, { state }); moveCardToZone(state.bot, host, "field", state.bot, { state }); }
    else state.turnCounter = 5;
    assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), true);
  }
});

test("310 original and Grimoire copy keep independent target protections", () => {
  const host = make(302); const ally = make(307); const grimoire = equip(host); const spell = make(310);
  const state = simulationState({ ...activeState(), bot: { field: [host, ally], spellTrap: [grimoire], hand: [spell] } });
  const ai = strategy();
  ai.simulateMainPhaseAction(state, { type: "spell", cardId: 310, cardName: spell.name, index: 0,
    activationContext: { decisions: { selections: { arcanist_ice_barrier_target: [required(ally.instanceId)] } } } });
  ai.simulateMainPhaseAction(state, { type: "spellTrapEffect", cardId: 301, cardName: grimoire.name, zoneIndex: 0,
    activationContext: { decisions: { selections: { arcanist_ice_barrier_target: [required(host.instanceId)] } } } });
  assert.equal(state._simReplacementEffects?.length, 2);
  assert.ok(replaceSimulatedBattleDestruction(state, ally));
  assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), false);
  assert.equal(destroySimulatedCard(ally, state.bot, state.player, state, {}), true);
  assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), true);
});

test("313 equip creates no destruction trigger and intrinsic protection suspends while negated", () => {
  const host = make(313); const enemy = make(307, "player"); const grimoire = make(301);
  const state = simulationState({ ...activeState(), bot: { field: [host], hand: [grimoire] }, player: { field: [enemy] } });
  strategy().simulateMainPhaseAction(state, { type: "spell", cardId: 301, cardName: grimoire.name, index: 0 });
  assert.ok(state.player.field.includes(enemy));
  assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), false);
  host.effectsNegated = true;
  assert.equal(destroySimulatedCard(host, state.bot, state.player, state, {}), true);
});

test("314 spell event debuffs only witnessed targets and does not reverse on source exit", () => {
  const azrath = make(314); const enemy = make(307, "player"); const late = make(307, "player"); const spell = make(304);
  const state = simulationState({ ...activeState(), bot: { field: [azrath], hand: [spell] }, player: { field: [enemy] } });
  const ai = strategy();
  ai.simulateMainPhaseAction(state, { type: "spell", cardId: 304, cardName: spell.name, index: 0,
    activationContext: { decisions: { selections: { lightning_magic_lance_target: [required(azrath.instanceId)] } } } });
  assert.equal(enemy.atk, required(enemy.baseAtk) - 100);
  appendSimulatedFieldCard(state.player.field, late); ai.applySimulatedArcanistPassiveStats(state);
  assert.equal(late.atk, late.baseAtk);
  moveCardToZone(state.bot, azrath, "graveyard", state.bot, { state }); ai.applySimulatedArcanistPassiveStats(state);
  assert.equal(enemy.atk, required(enemy.baseAtk) - 100);
});

test("314 does not witness earlier or opposing activations and temporary reductions expire", () => {
  const azrath = make(314); const enemy = make(307, "player");
  const state = simulationState({ ...activeState(), bot: { hand: [azrath] }, player: { field: [enemy] } });
  emitSimulatedSpellActivation(state, make(304));
  moveCardToZone(state.bot, azrath, "field", state.bot, { state });
  emitSimulatedSpellActivation(state, make(304, "player"), "player");
  assert.equal(enemy.atk, enemy.baseAtk);
  emitSimulatedSpellActivation(state, make(304)); assert.equal(enemy.atk, required(enemy.baseAtk) - 100);
  resolveSimulatedEndPhase(state); assert.equal(enemy.atk, enemy.baseAtk);
});

for (const id of [301, 304, 309, 311, 312]) {
  for (const wasSet of id === 312 || id === 301 ? [false] : [false, true]) {
    test(`314 witnesses Spell ${id} exactly once when activated from ${wasSet ? "set" : "hand"}`, () => {
      const azrath = make(314); const enemy = make(307, "player"); const spell = make(id);
      spell.isFacedown = wasSet;
      const state = simulationState({ ...activeState(), bot: { field: [azrath],
        hand: wasSet ? [] : [spell], spellTrap: wasSet ? [spell] : [] }, player: { field: [enemy] } });
      strategy().simulateMainPhaseAction(state, wasSet
        ? { type: "spellTrapEffect", cardId: id, cardName: spell.name, zoneIndex: 0 }
        : { type: "spell", cardId: id, cardName: spell.name, index: 0 });
      const factor = id === 301 ? 0.5 : 1; // Equipping Azrath also halves the current stats.
      assert.equal(enemy.atk, Math.floor((required(enemy.baseAtk) - 100) * factor));
      assert.equal(enemy.def, Math.floor((required(enemy.baseDef) - 100) * factor));
    });
  }
}

test("314 does not treat the field Spell ignition as a Spell activation", () => {
  const azrath = make(314); const enemy = make(307, "player"); const library = make(312);
  const state = simulationState({ ...activeState(), bot: { field: [azrath], fieldSpell: library }, player: { field: [enemy] } });
  strategy().simulateMainPhaseAction(state, { type: "fieldEffect", cardId: 312, cardName: library.name });
  assert.equal(enemy.atk, enemy.baseAtk);
  assert.equal(enemy.def, enemy.baseDef);
});

test("310 protections from consecutive turns remain independent", () => {
  const first = make(302); const second = make(307); const spell = make(310);
  const state = simulationState({ ...activeState(), bot: { field: [first, second] } });
  const action = required(required(spell.effects?.[0]).actions?.[0]);
  for (const target of [first, second]) {
    applySimulatedActions({ state, actions: [action], selections: { arcanist_ice_barrier_target: [target] }, options: { sourceCard: spell } });
    state.turnCounter += 1;
  }
  state.turnCounter = 4;
  assert.equal(state._simReplacementEffects?.length, 2);
  assert.ok(replaceSimulatedBattleDestruction(state, first));
  assert.ok(replaceSimulatedBattleDestruction(state, second));
});

test("310 protection follows the same field presence after control changes", () => {
  const host = make(302); const spell = make(310);
  const state = simulationState({ ...activeState(), bot: { field: [host] } });
  applySimulatedActions({ state, actions: [required(required(spell.effects?.[0]).actions?.[0])],
    selections: { arcanist_ice_barrier_target: [host] }, options: { sourceCard: spell } });
  applySimulatedActions({ state, selfId: "player", actions: [{ type: "take_control", targetRef: "target" }], selections: { target: [host] } });
  assert.ok(state.player.field.includes(host));
  assert.equal(destroySimulatedCard(host, state.player, state.bot, state, {}), false);
  assert.equal(destroySimulatedCard(host, state.player, state.bot, state, {}), true);
});

function masterPlanningFixture(seed: number, deckIds = [303, 4], graveIds = [301, 301, 304], actor: "player" | "bot" = "bot", opponentDeck = [4]) {
  const bot = new Bot();
  bot.id = actor;
  const game = createRuntimeGame({ ...(actor === "bot" ? { opponentOverride: bot } : {}), laboratoryMode: true,
    captureReplay: false, randomSeed: seed, chainResponseTimeoutMs: 0 });
  if (actor === "player") game.player = unsafeFixture<typeof game.player>(bot,
    "Concrete Bot implements Player; this fixture exercises the inverted physical seat.");
  game.turn = actor; game.phase = "main1"; game.turnCounter = 4;
  const card = (id: number, owner = bot.id) => new Card(cardDefinition(id), owner);
  bot.hand.push(card(308));
  bot.deck.push(...deckIds.map(id => card(id)));
  bot.graveyard.push(...graveIds.map(id => card(id)));
  placeFieldCards(bot.field, card(1));
  const opponent = game[actor === "bot" ? "player" : "bot"];
  placeFieldCards(opponent.field, card(1, opponent.id));
  opponent.deck.push(...opponentDeck.map(id => card(id, opponent.id)));
  const arcanist = new ArcanistStrategy(bot);
  bot.strategy = arcanist;
  const state = bot.cloneGameState(unsafeFixture<BotCloneGamePort>(game,
    "Concrete Game supplies the live cards and planning fields consumed by the Bot clone bridge."));
  const action = required(arcanist.generateMainPhaseActions(state)
    .find(candidate => candidate.type === "summon" && candidate.cardId === 308));
  return { game, bot, arcanist, state, action };
}

for (const actor of ["player", "bot"] as const) for (const seed of [42, 601]) {
  test(`308 projects an unknown draw after recycling distinct copies (${actor}, seed ${seed})`, t => {
    const { game, arcanist, state, action } = masterPlanningFixture(seed, [303, 4], [301, 301, 304], actor);
    t.after(() => game.dispose());
    const before = createCanonicalStateSnapshot(game);
    const rngBefore = game.getRandomState();
    const recycled = state.bot.graveyard.slice();
    const tribute = required(state.bot.field[0]);
    const master = required(state.bot.hand[0]);
    const resources = [...state.bot.deck, ...recycled];
    const opponentDeck = state.player.deck.slice();
    const opponentHand = state.player.hand.slice();
    assert.notEqual(recycled[0]?.instanceId, recycled[1]?.instanceId);

    arcanist.simulateMainPhaseAction(state, action);

    assert.deepEqual(createCanonicalStateSnapshot(game), before, "planning cannot mutate the live game");
    assert.deepEqual(game.getRandomState(), rngBefore, "planning cannot consume runtime shuffle RNG");
    assert.deepEqual(state.player.deck, opponentDeck, "the opponent must not pay for the draw");
    assert.deepEqual(state.player.hand, opponentHand, "the opponent must not receive the draw");
    assert.equal(state.bot.field[0]?.instanceId, master.instanceId);
    assert.deepEqual(state.bot.graveyard, [tribute], "only the tribute remains after all three returns");
    assert.equal(state.bot.deck.length, resources.length - 1);
    assert.equal(state.bot.hand.length, 1);
    const drawn = required(state.bot.hand[0]);
    assert.equal(drawn._simUnknownDraw, true);
    assert.equal(drawn.id, undefined);
    assert.equal(drawn.name, undefined);
    assert.equal(drawn.cardKind, undefined);
    assert.equal(state._simRequiresReplan, true);
    assert.equal(state._simUnknownDrawCount, 1);
    const projectedResources = [...state.bot.deck, drawn];
    assert.equal(projectedResources.length, resources.length, "draw transfers exactly one resource");
    assert.equal(new Set(projectedResources.map(card => card.instanceId)).size, resources.length);
    assert.ok(state.bot.deck.every(card => resources.includes(card)), "surviving deck copies retain identity");
    assert.ok(!resources.some(card => card.instanceId === drawn.instanceId), "unknown resource cannot impersonate a known copy");
  });
}

test("308's projected hand is invariant under hidden Deck identities and order", t => {
  const hands = [];
  for (const deck of [[303, 4], [4, 303], [1, 302]]) {
    const { game, arcanist, state, action } = masterPlanningFixture(42, deck);
    t.after(() => game.dispose());
    arcanist.simulateMainPhaseAction(state, action);
    hands.push(state.bot.hand);
  }
  assert.deepEqual(hands[0], hands[1]);
  assert.deepEqual(hands[0], hands[2]);
});

test("308 can project its draw when the Deck was empty before recycling", t => {
  const { game, arcanist, state, action } = masterPlanningFixture(42, [], [301]);
  t.after(() => game.dispose());
  arcanist.simulateMainPhaseAction(state, action);
  assert.equal(state.bot.deck.length, 0);
  assert.equal(state.bot.hand.length, 1);
  assert.equal(state.bot.hand[0]?._simUnknownDraw, true);
  assert.equal(state._simRequiresReplan, true);
  assert.equal(state._simUnknownDrawCount, 1);
});

test("308 in the inverted seat draws even when the opponent's Deck is empty", t => {
  const { game, arcanist, state, action } = masterPlanningFixture(42, [303, 4], [301], "player", []);
  t.after(() => game.dispose());
  arcanist.simulateMainPhaseAction(state, action);
  assert.equal(state.bot.hand.length, 1);
  assert.equal(state.bot.hand[0]?._simUnknownDraw, true);
  assert.equal(state.bot.hand[0]?.owner, "player");
  assert.equal(state._simRequiresReplan, true);
  assert.equal(state.player.hand.length, 0);
});

test("308 without an eligible Spell neither draws nor adds a replan boundary", t => {
  const { game, arcanist, state, action } = masterPlanningFixture(42, [303, 4], [302]);
  t.after(() => game.dispose());
  const deck = state.bot.deck.slice();
  const nonSpell = required(state.bot.graveyard[0]);
  arcanist.simulateMainPhaseAction(state, action);
  assert.deepEqual(state.bot.deck, deck);
  assert.equal(state.bot.hand.length, 0);
  assert.ok(state.bot.graveyard.includes(nonSpell));
  assert.notEqual(state._simRequiresReplan, true);
  assert.equal(state._simUnknownDrawCount ?? 0, 0);
});

for (const actor of ["player", "bot"] as const) test(`308 ends its actual turn-line simulation at the unknown draw (${actor})`, async t => {
  const { game, bot, arcanist, state } = masterPlanningFixture(42, [303, 4], [301, 301, 304], actor);
  t.after(() => game.dispose());
  let generations = 0;
  const result = await turnLineSearch(state, {
    bot,
    generateMainPhaseActions(current) {
      generations++;
      // Isolate this legal candidate while keeping its real generation and simulation.
      return arcanist.generateMainPhaseActions(current)
        .filter(candidate => candidate.type === "summon" && candidate.cardId === 308);
    },
    simulateMainPhaseAction: arcanist.simulateMainPhaseAction.bind(arcanist),
    evaluateBoardV2: arcanist.evaluateBoardV2.bind(arcanist),
  }, { maxDepth: 4 });
  assert.ok(result);
  assert.equal(result.completion.terminationReason, "requires_replan");
  assert.equal(result.sequence.length, 1);
  const firstAction = required(result.sequence[0]);
  assert.ok("cardId" in firstAction);
  assert.equal(firstAction.cardId, 308);
  assert.equal(generations, 1, "no continuation is generated using the unresolved draw");
});
