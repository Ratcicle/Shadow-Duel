import { placeFieldCards } from "./helpers/game.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Card from "../src/core/Card.js";
import { cardDefinition, required, selectedCards, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame } from "./helpers/game.js";
import { cleanupTempBoosts } from "../src/core/game/turn/cleanup.js";

for (const duration of ["damage_calculation", "end_of_damage_step"] as const) {
  test(`removing ${duration} increases retires only their expiry records and permits later buffs`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose());
    game.disablePresentationDelays = true;
    const monster = new Card({ id: 99410, name: "Stat expiry fixture", cardKind: "monster", atk: 2000, def: 2000 }, game.player.id);
    placeFieldCards(game.player.field, monster);
    const ctx = { source: monster, player: game.player, opponent: game.bot };
    const targets = { target: [monster] };
    await game.effectEngine.applyActions([{ type: "buff_stats_temp", targetRef: "target", atkBoost: 1000, defBoost: 700, duration }], ctx, targets);
    await game.effectEngine.applyActions([{ type: "remove_stat_increases", targetRef: "target", stats: ["atk", "def"] }], ctx, targets);
    assert.deepEqual([monster.atk, monster.def], [2000, 2000]);
    await game.effectEngine.applyActions([{ type: "buff_stats_temp", targetRef: "target", atkBoost: 500, defBoost: 200, duration: "end_of_turn" }], ctx, targets);
    game.clearDamageCalculationBuffs();
    game.clearEndOfDamageStepBuffs();
    assert.deepEqual([monster.atk, monster.def], [2500, 2200]);
    assert.deepEqual([monster.tempAtkBoost, monster.tempDefBoost], [500, 200]);
    cleanupTempBoosts(game.player);
    assert.deepEqual([monster.atk, monster.def], [2000, 2000]);
  });
}

test("Arctroth declares damage-calculation triggers and synchronized timing text", () => {
  const definition = cardDefinition("Shadow-Heart Demon Arctroth");
  const effects = required(definition.effects).filter(effect => effect.id.endsWith("remove_stat_increases"));
  assert.equal(effects.length, 2);
  for (const effect of effects) {
    assert.equal(effect.event, "damage_step");
    assert.deepEqual(effect.damageStepTimings, ["damage_calculation"]);
    assert.equal(effect.triggerRequirement, "mandatory");
    assert.deepEqual(effect.actions, [{ type: "remove_stat_increases", targetRef: "battle_opponent", stats: ["atk", "def"] }]);
  }
  assert.equal(definition.description,
    "If this card is Tribute Summoned: You can target 1 card your opponent controls; destroy it.\n\nDuring damage calculation, if this card battles an opponent's monster: Remove all increases to that monster's ATK/DEF.");
  const locale = JSON.parse(readFileSync(new URL("../public/locales/pt-br.json", import.meta.url), "utf8"));
  assert.equal(locale.cards["104"].description,
    "Se este card for Invocado por Invocação-Tributo: você pode escolher 1 card que seu oponente controla; destrua-o.\n\nDurante o cálculo de dano, se este card batalhar contra um monstro do oponente: remova todos os aumentos no ATK/DEF desse monstro.");
});

for (const arctrothOwnerId of ["player", "bot"] as const) {
  for (const arctrothAttacks of [true, false]) {
    test(`Arctroth and Hyperion use SEGOC/LIFO during calculation (Arctroth=${arctrothOwnerId}, attacks=${arctrothAttacks})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
      t.after(() => game.dispose());
      const arctrothOwner = game[arctrothOwnerId];
      const hyperionOwner = game[arctrothOwnerId === "player" ? "bot" : "player"];
      game.turn = arctrothAttacks ? arctrothOwner.id : hyperionOwner.id;
      game.phase = "battle";
      game.battleStep = "battle";
      game.turnCounter = 2;
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = async () => {};
      game.player.controllerType = game.bot.controllerType = "human";
      game.ui.showChainResponseModal = async () => null;
      const arctroth = new Card(cardDefinition("Shadow-Heart Demon Arctroth"), arctrothOwner.id);
      const hyperion = new Card(cardDefinition("Luminous God Hyperion"), hyperionOwner.id);
      arctroth.position = hyperion.position = "attack";
      placeFieldCards(arctrothOwner.field, arctroth);
      placeFieldCards(hyperionOwner.field, hyperion);
      const arctrothEffect = `shadow_heart_arctroth_${arctrothAttacks ? "attack" : "defense"}_remove_stat_increases`;
      const hyperionEffect = `luminous_god_hyperion_${arctrothAttacks ? "defense" : "attack"}_dark_boost`;
      const resolutions: Array<{ id: string; level: number; chain: unknown; controller: string | null; timing: string | null; atk: number; def: number }> = [];
      game.on("chain_link_resolution", payload => {
        if (payload.stage !== "completed" || (payload.effectId !== arctrothEffect && payload.effectId !== hyperionEffect)) return;
        resolutions.push({ id: payload.effectId, level: payload.chainLevel, chain: payload.chainId,
          controller: payload.controllerId, timing: game.activeDamageStepTransaction?.timing || null,
          atk: hyperion.atk, def: hyperion.def });
      });
      await game.resolveCombat(arctrothAttacks ? arctroth : hyperion, arctrothAttacks ? hyperion : arctroth);
      assert.equal(resolutions.length, 2);
      assert.deepEqual(resolutions.map(entry => entry.id), arctrothAttacks
        ? [hyperionEffect, arctrothEffect] : [arctrothEffect, hyperionEffect]);
      assert.deepEqual(resolutions.map(entry => entry.level), [2, 1]);
      assert.notEqual(resolutions[0]?.chain, null);
      assert.equal(resolutions[0]?.chain, resolutions[1]?.chain);
      assert.equal(resolutions[1]?.controller, game.turn);
      assert.deepEqual(resolutions.map(entry => entry.timing), ["damage_calculation", "damage_calculation"]);
      assert.deepEqual(resolutions.map(entry => [entry.atk, entry.def]), arctrothAttacks
        ? [[4000, 4000], [3000, 3000]] : [[3000, 3000], [4000, 4000]]);
      assert.equal(arctrothOwner.lp, 8000 - (arctrothAttacks ? 400 : 1400));
      assert.equal(hyperionOwner.lp, 8000);
      assert.ok(arctrothOwner.graveyard.includes(arctroth));
      assert.ok(hyperionOwner.field.includes(hyperion));
      assert.deepEqual([hyperion.atk, hyperion.def], [3000, 3000]);
      assert.deepEqual([hyperion.tempAtkBoost, hyperion.tempDefBoost], [0, 0]);
      assert.deepEqual(game.damageCalculationTempBuffs, []);
    });
  }
}

for (const { laboratoryMode, actorId, activateEffect } of [
  { laboratoryMode: false, actorId: "player", activateEffect: true },
  { laboratoryMode: true, actorId: "player", activateEffect: true },
  { laboratoryMode: true, actorId: "bot", activateEffect: true },
  { laboratoryMode: true, actorId: "bot", activateEffect: false },
] as const) {
  for (const useHeartbearer of [false, true]) {
    test(`Arctroth ${activateEffect ? "opens destruction targeting" : "can decline destruction"} after UI tribute selection (lab=${laboratoryMode}, actor=${actorId}, Heartbearer=${useHeartbearer})`, async (t) => {
      const game = createRuntimeGame({ laboratoryMode, captureReplay: false });
      t.after(() => game.dispose());
      const actor = game[actorId];
      const opponent = actorId === "player" ? game.bot : game.player;
      game.turn = actor.id;
      game.turnCounter = 2;
      game.phase = "main1";
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = async () => {};
      game.player.controllerType = game.bot.controllerType = "human";
      game.ui.showChainResponseModal = async () => null;
      const callbacks: {
        hand?: Parameters<typeof game.ui.bindPlayerHandClick>[0];
        field?: Parameters<typeof game.ui.bindPlayerFieldClick>[0];
        summon?: Parameters<typeof game.ui.showSummonModal>[1];
      } = {};
      if (actorId === "player") {
        game.ui.bindPlayerHandClick = (callback) => { callbacks.hand = callback; };
        game.ui.bindPlayerFieldClick = (callback) => { callbacks.field = callback; };
      } else {
        game.ui.bindBotHandClick = (callback) => { callbacks.hand = callback; };
        game.ui.bindBotFieldClick = (callback) => { callbacks.field = callback; };
      }
      game.ui.showSummonModal = (_index, callback) => { callbacks.summon = callback; };
      let confirmations = 0;
      let targetSelections = 0;
      const selectionDuringResolution: boolean[] = [];
      game.ui.showConfirmPrompt = async () => {
        confirmations++;
        assert.equal(game.pendingTributeSummonSelection, null);
        return activateEffect;
      };
      game.ui.showFieldTargetingControls = () => {
        targetSelections++;
        selectionDuringResolution.push(game.chainSystem.isResolving);
        // Supply the human choice through the real selection session.
        queueMicrotask(() => {
          const selection = required(game.targetSelection);
          const requirement = required(selection.requirements[0]);
          selection.selections[requirement.id] = [required(requirement.candidates[0]).key];
          void game.finishTargetSelection();
        });
        return { close() {}, updateState() {} };
      };
      const arctroth = new Card(cardDefinition("Shadow-Heart Demon Arctroth"), actor.id);
      actor.hand.push(arctroth);
      if (useHeartbearer) {
        placeFieldCards(actor.field, new Card(cardDefinition("Shadow-Heart Heartbearer"), actor.id));
      } else {
        placeFieldCards(actor.field, ...[0, 1].map(() => new Card(cardDefinition("Nightmare Steed"), actor.id)));
      }
      const target = new Card(cardDefinition("Nightmare Steed"), opponent.id);
      target.isFacedown = true;
      placeFieldCards(opponent.field, target);
      game.bindCardInteractions();
      if (actorId === "bot") {
        const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: unsafeFixture<Document>({
            getElementById: () => null,
            querySelectorAll: () => [],
          }, "Laboratory tribute highlighting and board updates only query absent DOM elements in this headless test."),
        });
        t.after(() => {
          if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
          else Reflect.deleteProperty(globalThis, "document");
        });
      }
      const event = unsafeFixture<MouseEvent>({}, "Headless bound click handler does not read mouse event fields.");
      const element = unsafeFixture<HTMLElement>({}, "Tribute branch does not read the card element; presentation uses the headless adapter.");
      await required(callbacks.hand)(event, element, 0);
      await required(callbacks.summon)("attack");
      assert.ok(game.pendingTributeSummonSelection);
      await required(callbacks.field)(event, element, 0);
      if (!useHeartbearer) await required(callbacks.field)(event, element, 1);
      assert.equal(confirmations, 1);
      assert.equal(targetSelections, activateEffect ? 1 : 0);
      assert.deepEqual(selectionDuringResolution, activateEffect ? [false] : []);
      assert.ok(actor.field.includes(arctroth));
      assert.ok(activateEffect ? opponent.graveyard.includes(target) : opponent.field.includes(target));
      assert.equal(game.pendingTributeSummonSelection, null);
    });
  }
}

for (const zone of ["field", "spellTrap", "fieldSpell"] as const) {
  for (const response of ["pass", "move_target", "negate"] as const) {
    test(`Arctroth declares its ${zone} target before responses (${response})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
      t.after(() => game.dispose());
      game.turn = game.player.id;
      game.turnCounter = 2;
      game.phase = "main1";
      game.disablePresentationDelays = true;
      game.player.controllerType = game.bot.controllerType = "human";
      game.ui.showConfirmPrompt = async () => true;
      game.ui.showChainResponseModal = async () => null;
      const arctroth = new Card(cardDefinition("Shadow-Heart Demon Arctroth"), game.player.id);
      game.player.hand.push(arctroth);
      placeFieldCards(game.player.field, new Card(cardDefinition("Shadow-Heart Heartbearer"), game.player.id));
      const target = new Card(zone === "field"
        ? { id: 99401, name: "Declared destruction target", cardKind: "monster", atk: 1000, def: 1000 }
        : { id: 99402, name: "Declared destruction target", cardKind: "spell", subtype: zone === "fieldSpell" ? "field" : "normal" }, game.bot.id);
      target.isFacedown = zone !== "fieldSpell";
      if (zone === "fieldSpell") game.bot.fieldSpell = target;
      else placeFieldCards(game.bot[zone], target);
      let selections = 0;
      game.ui.showFieldTargetingControls = () => {
        selections++;
        queueMicrotask(() => {
          const selection = required(game.targetSelection);
          const requirement = required(selection.requirements[0]);
          selection.selections[requirement.id] = [required(requirement.candidates[0]).key];
          void game.finishTargetSelection();
        });
        return { close() {}, updateState() {} };
      };
      let declaredBeforeResponses = false;
      const alternate = new Card({ id: 99403, name: "Do not retarget", cardKind: "monster", atk: 500, def: 500 }, game.bot.id);
      game.chainSystem.offerChainResponses = async () => {
        const link = game.chainSystem.getLastChainLink();
        if (link?.effectId === "shadow_heart_arctroth_on_summon") {
          declaredBeforeResponses = selectedCards(link.targetSelections, "arctroth_destroy_target")?.[0] === target;
          if (response === "move_target") {
            await game.moveCard(target, game.bot, "hand", { fromZone: zone, awaitEvents: true });
            placeFieldCards(game.bot.field, alternate);
          } else if (response === "negate") {
            game.chainSystem.markChainLinkEffectNegated(link.linkId);
          }
        }
        return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
      };
      await game.performNormalSummon(game.player, 0, "attack", false, [0]);
      assert.equal(declaredBeforeResponses, true);
      assert.equal(selections, 1);
      assert.equal(game.bot.graveyard.includes(target), response === "pass");
      assert.equal(game.bot.graveyard.includes(alternate), false);
      if (response === "move_target") assert.ok(game.bot.hand.includes(target));
    });
  }
}

for (const defending of [false, true]) {
  for (const reduction of [0, 500, 1500, 2500, 3000]) {
    test(`Arctroth preserves reductions of ${reduction} when ${defending ? "defending" : "attacking"}`, async (t) => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
      t.after(() => game.dispose());
      game.turnCounter = 2;
      game.phase = "battle";
      game.turn = defending ? game.bot.id : game.player.id;
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = async () => {};
      game.player.controllerType = "human";
      game.bot.controllerType = "human";
      game.ui.showChainResponseModal = async () => null;
      const arctroth = new Card(cardDefinition("Shadow-Heart Demon Arctroth"), game.player.id);
      const opponent = new Card({ id: 99099, name: "Mixed stat modifiers", cardKind: "monster", atk: 2000, def: 2000 }, game.bot.id);
      opponent.atk = opponent.def = 3000 - reduction;
      opponent.permanentBuffsBySource = {
        increase: { atk: 1000, def: 1000 },
        decrease: { atk: -reduction, def: -reduction },
      };
      placeFieldCards(game.player.field, arctroth);
      placeFieldCards(game.bot.field, opponent);
      let removals = 0;
      game.on("stat_increases_removed", () => {
        removals++;
        assert.equal(opponent.atk, Math.max(0, 2000 - reduction));
        assert.equal(opponent.def, Math.max(0, 2000 - reduction));
        assert.equal(opponent.permanentBuffsBySource?.increase, undefined);
        if (reduction > 0) assert.deepEqual(opponent.permanentBuffsBySource?.decrease, { atk: -reduction, def: -reduction });
      });
      const lp = game.bot.lp;
      await game.resolveCombat(defending ? opponent : arctroth, defending ? arctroth : opponent);
      assert.equal(removals, 1);
      assert.equal(game.bot.lp, lp - (2600 - Math.max(0, 2000 - reduction)));
    });
  }
}

