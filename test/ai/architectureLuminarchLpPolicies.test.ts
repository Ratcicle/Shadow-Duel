import assert from "node:assert/strict";
import test from "node:test";
import LuminarchStrategy from "../../src/core/ai/LuminarchStrategy.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { evaluateMoonlitReviveCandidate } from "../../src/core/ai/luminarch/moonlitPlanning.js";
import { canAttemptLethal } from "../../src/core/ai/luminarch/combos.js";
import { shouldPlaySpell } from "../../src/core/ai/luminarch/spellPriority.js";
import { required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const actor of ["bot", "player"] as const) for (const used of [0, 1, 2]) {
  test(`Moonlit forecasts Citadel plus Holy Ascension with the real remaining discount budget (${actor}/${used})`, t => {
    const game = createRuntimeGame({ disableChains: false });
    t.after(() => game.dispose("architecture_luminarch_lp_policy"));
    game.turnCounter = 4;
    const owner = game[actor];
    owner.lp = 500;
    const knight = required(game.createCardForOwner(173, owner));
    const citadel = required(game.createCardForOwner(162, owner));
    const holy = required(game.createCardForOwner(163, owner));
    const revive = required(game.createCardForOwner(151, owner));
    placeFieldCards(owner.field, knight);
    owner.fieldSpell = citadel;
    owner.hand.push(holy);
    owner.graveyard.push(revive);
    const reducer = required(knight.effects.find(entry => entry.id === "luminarch_pure_knight_lp_discount"));
    for (let count = 0; count < used; count++) game.effectEngine.markOncePerTurn(reducer, { player: owner, source: knight });
    const { state } = createGameTreeCopy(game, owner);
    delete state._gameRef;
    const analysis = new LuminarchStrategy(state.bot).buildPlanningAnalysis(state);
    const before = structuredClone(state);

    const quoted: number[] = [];
    for (const source of [citadel, holy]) {
      const effect = required(source.effects.find(entry => entry.id === (source === citadel ? "sanctum_luminarch_citadel_buff" : "luminarch_holy_ascension_boost")));
      const payment = required(effect.activationCosts?.find(action => action.type === "pay_lp"));
      quoted.push(game.effectEngine.resolveLpCost(payment, { player: owner, source }, 1000).finalAmount);
    }
    assert.deepEqual(quoted, used === 0 ? [0, 0] : used === 1 ? [0, 1000] : [1000, 1000]);
    const plan = evaluateMoonlitReviveCandidate(required(state.bot.graveyard[0]), analysis);
    assert.equal(plan.projectedAtk, required(revive.atk) + (used === 0 ? 1300 : used === 1 ? 800 : 0));
    assert.deepEqual(state, before, "each subset owns its hypothetical ledger and cannot consume the planning state");
  });
}

for (const actor of ["bot", "player"] as const) for (const used of [0, 2]) {
  test(`Holy Ascension's existing lethal policy uses its actual affordable payment (${actor}/${used})`, t => {
    const game = createRuntimeGame({ disableChains: false });
    t.after(() => game.dispose("architecture_luminarch_lp_policy"));
    game.turnCounter = 4; game.turn = actor; game.phase = "main1";
    const owner = game[actor], opponent = game[actor === "bot" ? "player" : "bot"];
    owner.lp = 500; opponent.lp = 2200;
    const knight = required(game.createCardForOwner(173, owner));
    knight.position = "defense";
    const attacker = required(game.createCardForOwner(151, owner));
    const holy = required(game.createCardForOwner(163, owner));
    placeFieldCards(owner.field, knight, attacker);
    owner.hand.push(holy);
    const reducer = required(knight.effects.find(entry => entry.id === "luminarch_pure_knight_lp_discount"));
    for (let count = 0; count < used; count++) game.effectEngine.markOncePerTurn(reducer, { player: owner, source: knight });
    const effect = required(holy.effects.find(entry => entry.id === "luminarch_holy_ascension_boost"));
    const payment = required(effect.activationCosts?.find(action => action.type === "pay_lp"));
    const quoted = game.effectEngine.resolveLpCost(payment, { player: owner, source: holy }, 1000, { preview: true });
    assert.equal(quoted.finalAmount, used === 0 ? 0 : 1000);
    const { state } = createGameTreeCopy(game, owner);
    delete state._gameRef;
    const analysis = new LuminarchStrategy(state.bot).buildPlanningAnalysis(state);
    assert.equal(canAttemptLethal(analysis), quoted.finalAmount <= owner.lp);
    const decision = shouldPlaySpell(required(state.bot.hand[0]), analysis);
    assert.equal(decision.yes, used === 0);
    if (used === 0) assert.equal(decision.priority, 15, "the existing direct-lethal weight is preserved");
  });
}

for (const actor of ["bot", "player"] as const) for (const lp of [1500, 2500]) {
  test(`Marshal generation preserves its existing 500-LP reserve without a Spell/Trap discount (${actor}/${lp})`, t => {
    const game = createRuntimeGame({ disableChains: false });
    t.after(() => game.dispose("architecture_luminarch_lp_policy"));
    game.turnCounter = 4; game.turn = actor; game.phase = "main1";
    const owner = game[actor];
    owner.lp = lp;
    const knight = required(game.createCardForOwner(173, owner));
    const marshal = required(game.createCardForOwner(155, owner));
    placeFieldCards(owner.field, knight);
    owner.hand.push(marshal);
    const effect = required(marshal.effects.find(entry => entry.timing === "ignition" && entry.activationZones?.includes("hand")));
    const payment = required(effect.activationCosts?.find(action => action.type === "pay_lp"));
    assert.equal(game.effectEngine.resolveLpCost(payment, { player: owner, source: marshal }, 2000, { preview: true }).finalAmount, 2000);
    const { state } = createGameTreeCopy(game, owner);
    delete state._gameRef;
    const strategy = new LuminarchStrategy(state.bot);
    assert.equal(strategy.generateMainPhaseActions(state).some(action => action.type === "handIgnition" && action.cardId === 155), lp >= 2500);
  });
}
