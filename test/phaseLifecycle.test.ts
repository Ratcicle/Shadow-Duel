import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { CardConstructorData } from "../src/core/contracts/cards.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { getTurnCardActivations } from "../src/core/game/events/activationHistory.js";

function setup(t: TestContext, turn: "player" | "bot" = "player") {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, randomSeed: 73 });
  t.after(() => game.dispose("phase_lifecycle_test"));
  game.disablePresentationDelays = true;
  game.phaseDelayMs = 0;
  game.turn = turn;
  game.turnCounter = 2;
  game.phase = "main2";
  for (const owner of [game.player, game.bot]) {
    owner.controllerType = "human";
    owner.deck.push(...Array.from({ length: 8 }, () => new Card(cardDefinition(1), owner.id)));
  }
  return game;
}

for (const seat of ["player", "bot"] as const) {
  test(`B17 continuous activation count clears for both players at the next turn and on duel reset (${seat})`, async t => {
    const game = setup(t, seat), owner = game[seat], source = new Card(cardDefinition(313), seat);
    placeFieldCards(owner.field, source);
    game.ui.showChainResponseModal = async () => null;
    for (const actor of [game.player, game.bot]) {
      await game.emit("spell_activated", { card: new Card(cardDefinition(310), actor.id), player: actor });
    }
    assert.equal(source.atk, source.baseAtk + 200);
    await completeTestSelections(game, Promise.resolve(game.endTurn()));
    assert.equal(game.turnCounter, 3);
    assert.equal(getTurnCardActivations(game).length, 0);
    assert.equal(source.atk, source.baseAtk);
    await game.emit("spell_activated", { card: new Card(cardDefinition(301), seat), player: owner });
    assert.equal(getTurnCardActivations(game).length, 1);
    game.resetDuelState();
    assert.equal(getTurnCardActivations(game).length, 0);
    assert.deepEqual(game.cardActivationHistory, { turnCounter: 0, entries: [] });
  });
}

const fastDefinitions: Record<"quick" | "quick-play", CardConstructorData> = {
  quick: { id: 990071, name: "Phase Quick Effect", cardKind: "monster", atk: 100, def: 100, level: 1,
    effects: [{ id: "phase_quick", timing: "ignition", speed: 2, isQuickEffect: true, activationZones: ["field"], oncePerTurn: true, usagePolicy: "use",
      actions: [{ type: "heal", amount: 137, player: "self" }] }] },
  "quick-play": { id: 990072, name: "Phase Quick-Play", cardKind: "spell", subtype: "quick",
    effects: [{ id: "phase_quick_play", timing: "on_play", speed: 2,
      actions: [{ type: "heal", amount: 137, player: "self" }] }] },
};

for (const route of ["next", "skip", "direct"] as const) {
  for (const source of ["spirit", "quick", "quick-play"] as const) {
    for (const controller of ["human", "ai"] as const) {
      test(`${route}: ${controller} ${source} interrupts End exit and renewed intent finishes once`, async t => {
        const game = setup(t);
        const owner = game.bot;
        owner.controllerType = controller;
        const card = new Card(source === "spirit" ? cardDefinition("Ancient Tree Spirit") : fastDefinitions[source], owner.id);
        if (source === "quick") placeFieldCards(owner.field, card);
        else {
          card.isFacedown = true; card.setTurn = card.turnSetOn = 1;
          placeFieldCards(owner.spellTrap, card);
        }
        if (source === "spirit") {
          for (let i = 0; i < 4; i++) placeFieldCards(owner.field, new Card(cardDefinition(1), owner.id));
        }
        let chosen = false;
        let choiceCalls = 0;
        const choose = <T extends { card?: object | null }>(candidates: readonly T[]): T | null => {
          choiceCalls++;
          if (game.turn !== "player" || game.phase !== "end" || chosen) return null;
          const candidate = candidates.find(candidate => candidate.card === card) ?? null;
          if (candidate) chosen = true;
          return candidate;
        };
        game.ui.showChainResponseModal = async candidates => choose(candidates);
        owner.strategy = { chooseChainResponse: ({ activatable }) => choose(activatable) ?? { pass: true } };
        let endEvents = 0;
        let standbyEvents = 0;
        game.on("end_phase", () => { endEvents++; });
        game.on("standby_phase", () => { standbyEvents++; });
        const initialLp = owner.lp;
        if (route === "next") await game.nextPhase();
        const finish = () => route === "next" ? game.nextPhase()
          : route === "skip" ? game.skipToPhase("end") : game.endTurn();
        await completeTestSelections(game, Promise.resolve(finish()));
        assert.equal(chosen, true, "legal End Phase response must be offered");
        assert.ok(choiceCalls > 0);
        assert.equal(game.turn, "player", "a response cancels the previous exit intent");
        assert.equal(game.phase, "end");
        assert.equal(game.turnCounter, 2);
        if (source === "spirit") assert.ok(owner.field.includes(card));
        else assert.equal(owner.lp, initialLp + 137);
        assert.equal(endEvents, 1, "End entry triggers precede its exit window and run once");
        await completeTestSelections(game, Promise.resolve(finish()));
        assert.equal(game.turn, "bot");
        assert.equal(game.phase, "main1");
        assert.equal(game.turnCounter, 3);
        assert.equal(endEvents, 1);
        assert.equal(standbyEvents, 1);
      });
    }
  }
}

for (const phase of ["draw", "standby", "main1", "end"] as const) {
  test(`pending ${phase} entry stops the transition before following work`, async t => {
    const game = setup(t);
    const original = game.checkAndOfferTraps.bind(game);
    game.checkAndOfferTraps = async (event, context) => event === "phase_start" && game.phase === phase
      ? { success: false, needsSelection: true }
      : original(event, context);
    const handBefore = game.player.hand.length;
    const turnBefore = game.turnCounter;
    let endEvents = 0;
    game.on("end_phase", () => { endEvents++; });
    if (phase === "end") await game.skipToPhase("end");
    else await game.startTurn();
    assert.equal(game.phase, phase);
    assert.equal(game.turn, "player");
    assert.equal(endEvents, 0);
    assert.equal(game.turnCounter, turnBefore + (phase === "end" ? 0 : 1));
    if (phase === "draw") assert.equal(game.player.hand.length, handBefore, "pending phase entry must finish before mandatory draw");
  });
}

for (const phase of ["draw", "standby"] as const) {
  test(`automatic ${phase} exit renews after a settled Chain without repeating draw/standby`, async t => {
    const game = setup(t);
    const card = new Card(fastDefinitions.quick, "bot");
    placeFieldCards(game.bot.field, card);
    let chosen = false;
    game.ui.showChainResponseModal = async candidates => {
      if (chosen || game.phase !== phase) return null;
      const choice = candidates.find(candidate => candidate.card === card) ?? null;
      if (choice) chosen = true;
      return choice;
    };
    let standbyEvents = 0;
    game.on("standby_phase", () => { standbyEvents++; });
    const initialHand = game.player.hand.length;
    const initialLp = game.bot.lp;
    await game.startTurn();
    assert.equal(chosen, true);
    assert.equal(game.phase, "main1");
    assert.equal(game.player.hand.length, initialHand + 1);
    assert.equal(game.bot.lp, initialLp + 137);
    assert.equal(standbyEvents, 1);
  });
}

test("shortcut stops at an intermediate response and does not enter End", async t => {
  const game = setup(t);
  game.phase = "main1";
  const quick = new Card(fastDefinitions.quick, "bot");
  placeFieldCards(game.bot.field, quick);
  let chosen = false;
  game.ui.showChainResponseModal = async candidates => {
    if (chosen) return null;
    const choice = candidates.find(candidate => candidate.card === quick) ?? null;
    if (choice) chosen = true;
    return choice;
  };
  await game.skipToPhase("end");
  assert.equal(chosen, true);
  assert.equal(game.phase, "main1");
  assert.equal(game.turnCounter, 2);
  await game.skipToPhase("end");
  assert.equal(game.turnCounter, 3);
  assert.equal(game.turn, "bot");
});

test("End entry target choice blocks finalization and renewed exit cannot duplicate its trigger", async t => {
  const game = setup(t);
  const trigger = new Card({ id: 990073, name: "End Phase Choice", cardKind: "monster", level: 1, atk: 100, def: 100,
    effects: [{ id: "end_phase_choice", timing: "on_event", event: "end_phase", triggerRequirement: "mandatory", triggerTiming: "if",
      targets: [{ id: "end_target", owner: "opponent", zone: "field", cardKind: "monster", count: { min: 1, max: 1 } }],
      actions: [{ type: "destroy", targetRef: "end_target" }] }] }, "player");
  placeFieldCards(game.player.field, trigger);
  placeFieldCards(game.bot.field, new Card(cardDefinition(1), "bot"), new Card(cardDefinition(1), "bot"));
  let endEvents = 0;
  game.on("end_phase", () => { endEvents++; });
  const pending = game.skipToPhase("end");
  // Event resolution can await the human choice. Observe the still-live choice,
  // then complete it through the canonical selection path.
  for (let i = 0; i < 100 && !game.targetSelection; i++) await new Promise<void>(resolve => setTimeout(resolve, 1));
  assert.ok(game.targetSelection, "End entry must leave the human target choice pending");
  assert.equal(game.turn, "player");
  assert.equal(game.phase, "end");
  assert.equal(game.turnCounter, 2);
  assert.equal(game.bot.graveyard.length, 0);
  await completeTestSelections(game, Promise.resolve(pending));
  assert.equal(game.bot.graveyard.length, 1);
  if (game.turn === "player") await game.skipToPhase("end");
  assert.equal(game.turn, "bot");
  assert.equal(game.turnCounter, 3);
  assert.equal(endEvents, 1);
  assert.equal(game.bot.graveyard.length, 1);
});

test("the real Bot renews an interrupted End exit from its own seat", async t => {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: true, captureReplay: false, randomSeed: 74 });
  t.after(() => game.dispose("bot_end_renewal"));
  game.turn = "bot"; game.turnCounter = 2; game.phase = "main2";
  game.disablePresentationDelays = true; game.phaseDelayMs = 0;
  game.player.controllerType = "human";
  for (const owner of [game.player, game.bot]) {
    owner.deck.push(...Array.from({ length: 8 }, () => new Card(cardDefinition(1), owner.id)));
  }
  const spirit = new Card(cardDefinition("Ancient Tree Spirit"), "player");
  spirit.isFacedown = true; spirit.setTurn = spirit.turnSetOn = 1;
  placeFieldCards(game.player.spellTrap, spirit);
  for (let i = 0; i < 4; i++) placeFieldCards(game.player.field, new Card(cardDefinition(1), "player"));
  game.ui.showChainResponseModal = async candidates => game.turn === "bot" && game.phase === "end"
    ? candidates.find(candidate => candidate.card === spirit) ?? null : null;
  let endEvents = 0;
  game.on("end_phase", () => { endEvents++; });
  await game.skipToPhase("end");
  assert.ok(game.player.field.includes(spirit));
  assert.equal(game.turn, "bot", "the old intent was cancelled before Bot renewal runs");
  assert.equal(game.phase, "end");
  for (let i = 0; i < 200 && game.turn === "bot"; i++) await new Promise<void>(resolve => setTimeout(resolve, 1));
  assert.equal(game.turn, "player", "scheduled real Bot.makeMove must issue its next canonical intent");
  for (let i = 0; i < 200 && game.phase !== "main1"; i++) await new Promise<void>(resolve => setTimeout(resolve, 1));
  assert.equal(game.phase, "main1");
  assert.equal(game.turnCounter, 3);
  assert.equal(endEvents, 1);
});

test("first-turn shortcut skips Battle and clears turn usage exactly once", async t => {
  const game = setup(t);
  game.turnCounter = 1; game.phase = "main1";
  game.player.directAttacksDeclaredThisTurn = 2;
  game.player.forbidDirectAttacksThisTurn = true;
  const exits: string[] = [];
  const original = game.checkAndOfferTraps.bind(game);
  game.checkAndOfferTraps = async (event, context) => {
    if (event === "phase_end") exits.push(`${game.turn}:${game.phase}`);
    return original(event, context);
  };
  await game.skipToPhase("end");
  assert.deepEqual(exits.slice(0, 3), ["player:main1", "player:main2", "player:end"]);
  assert.equal(exits.some(phase => phase.includes("battle")), false);
  assert.equal(game.turnCounter, 2);
  assert.equal(game.player.directAttacksDeclaredThisTurn, 0);
  assert.equal(game.player.forbidDirectAttacksThisTurn, false);
});

test("pending normal draw keeps its single draw and explicit advance resumes at Standby", async t => {
  const game = setup(t);
  const original = game.checkAndOfferTraps.bind(game);
  game.checkAndOfferTraps = async (event, context) => event === "normal_draw"
    ? { success: false, deferred: true } : original(event, context);
  let standbyEvents = 0;
  game.on("standby_phase", () => { standbyEvents++; });
  await game.startTurn();
  assert.equal(game.phase, "draw");
  assert.equal(game.player.hand.length, 1);
  await game.nextPhase();
  assert.equal(game.phase, "standby");
  assert.equal(standbyEvents, 1);
  await game.nextPhase();
  assert.equal(game.phase, "main1");
  assert.equal(game.player.hand.length, 1);
  assert.equal(standbyEvents, 1);
});

test("a new selection during the automatic phase delay prevents entering the next phase", async t => {
  const game = setup(t);
  game.waitForPhaseDelay = async () => { game.selectionState = "selecting"; };
  let standbyEvents = 0;
  game.on("standby_phase", () => { standbyEvents++; });
  await game.startTurn();
  assert.equal(game.phase, "draw");
  assert.equal(game.player.hand.length, 1);
  assert.equal(standbyEvents, 0);
});
