import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "./helpers/game.js";
import { replayCanonicalDuel } from "../src/core/game/replay/driver.js";
import { validateCanonicalReplay } from "../src/core/game/replay/canonical.js";
import type { ReplayDriverGamePort } from "../src/core/contracts/replay.js";
import { placeSimulationCards, simulationCard, simulationState } from "./helpers/simulation.js";
import { simulateLuminarchMainPhaseAction } from "../src/core/ai/luminarch/simulation.js";
import { attachSimulatedEquip } from "../src/core/ai/common/zones.js";
import ChainSystem from "../src/core/ChainSystem.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import { attachSimulatedEventEmitter } from "../src/core/ai/common/simulation.js";
import { replaceSimulatedBattleDestruction } from "../src/core/ai/common/simulatedActions/destruction.js";

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

for (const scenario of ["judgment", "crescent", "sunforged"] as const) {
  for (const accept of [false, true]) {
    test(`canonical replay preserves ${scenario} decisions (accept=${accept})`, async t => {
      const live = createRuntimeGame({ laboratoryMode: true, captureReplay: true, randomSeed: 165170 });
      const playback = createRuntimeGame({ laboratoryMode: true, captureReplay: false, replayMode: "playback" });
      t.after(() => { live.dispose(); playback.dispose(); });
      const install = (game: RuntimeGame) => {
        const start = game.startWithDecks.bind(game);
        game.startWithDecks = async options => {
          await start(options);
          game.turn = "player";
          game.turnCounter = 2;
          game.phase = "main1";
          game.battleStep = "battle";
          game.disablePresentationDelays = true;
          game.waitForBoardPresentation = async () => {};
          game.waitForPresentationDelay = async () => {};
          game.waitForAiPresentationStep = async () => {};
          game.player.controllerType = "human";
          game.bot.controllerType = "ai";
          game.player.deck.push(...game.player.hand.splice(0));
          game.bot.deck.push(...game.bot.hand.splice(0));
          const take = (owner: typeof game.player, id: number) => {
            const card = required(owner.deck.find(entry => entry.id === id));
            owner.deck.splice(owner.deck.indexOf(card), 1);
            return card;
          };
          const sourceId = scenario === "judgment" ? 170 : scenario === "crescent" ? 165 : 166;
          game.player.hand.push(take(game.player, sourceId));
          if (scenario === "judgment") {
            game.player.graveyard.push(take(game.player, 158), take(game.player, 154));
            game.player.hand.push(take(game.player, 168));
            placeFieldCards(game.bot.field, take(game.bot, 158), take(game.bot, 154));
          } else {
            placeFieldCards(game.player.field, take(game.player, 158));
            placeFieldCards(game.bot.field, take(game.bot, 154));
            required(game.bot.field[0]).atk = 3000;
          }
        };
        game.ui.showChainResponseModal = async () => null;
      };
      install(live);
      install(playback);
      live.ui.showConfirmPrompt = async () => accept;
      live.ui.showSpecialSummonPositionModal = (_card, confirm) => confirm("defense");
      live.ui.showMultiSelectModal = (candidates, _range, confirm) => required(confirm)([required(required(candidates)[0])]);
      live.ui.showTargetSelection = (contract, confirm) => {
        const requirement = required(required(required(contract).requirements)[0]);
        setImmediate(() => required(confirm)({ [requirement.id]: [required(requirement.candidates[0]).key] }));
        return { close() {} };
      };
      playback.ui.showConfirmPrompt = async () => assert.fail("Playback cannot ask for confirmation");
      playback.ui.showSpecialSummonPositionModal = () => assert.fail("Playback cannot ask for position");
      playback.ui.showMultiSelectModal = () => assert.fail("Playback cannot ask for summons");
      playback.ui.showTargetSelection = () => assert.fail("Playback cannot ask for targets");
      await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
        startAtDrawPhase: true, startingPlayer: "player", announceStartingPlayer: false,
        playerDeck: [165, 166, 170, 158, 154, 168, ...Array<number>(10).fill(3)],
        botDeck: [158, 154, ...Array<number>(12).fill(3)], playerExtraDeck: [], botExtraDeck: [] });
      let finished = false;
      const activation = live.tryActivateSpell(required(live.player.hand[0]), 0);
      void activation.then(() => { finished = true; }, () => { finished = true; });
      const submitted = new Set<NonNullable<RuntimeGame["targetSelection"]>>();
      const selections: Promise<unknown>[] = [];
      for (let attempts = 0; attempts < 1000 && !finished; attempts++) {
        const session = live.targetSelection;
        if (session && !submitted.has(session)) {
          submitted.add(session);
          for (const requirement of session.requirements) session.selections[requirement.id] = [required(requirement.candidates[0]).key];
          selections.push(live.finishTargetSelection());
        }
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      assert.equal(finished, true);
      await Promise.all(selections);
      await activation;
      if (scenario !== "judgment") {
        await live.nextPhase();
        await live.resolveCombat(required(live.player.field[0]), required(live.bot.field[0]));
      }
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "luminarch-resolution" }))));
      assert.ok(replay.decisions.length > 0);
      if (scenario === "judgment") {
        assert.equal(live.player.lp, 6500);
        assert.equal(live.player.field.some(card => card.id === 168), accept);
      } else {
        assert.equal(live.player.field.length, scenario === "crescent" || accept ? 1 : 0);
      }
      const result = await replayCanonicalDuel(replay, {
        game: unsafeFixture<ReplayDriverGamePort>(playback, "Concrete Game supplies canonical replay methods."),
      });
      assert.equal(result.ok, true);
      assert.equal(result.finalStateHash, replay.result?.finalStateHash);
      assert.equal(playback.decisionBroker.replayCursor, replay.decisions.length);
    });
  }
}

for (const seat of ["player", "bot"] as const) {
  for (const method of ["normal", "tribute", "flip", "special", "fusion", "synchro", "ascension"] as const) {
    for (const own of [false, true]) {
      test(`Halberd ${seat}: ${method} to ${own ? "own" : "opponent"} field`, async t => {
        const game = setup(t);
        const owner = game[seat];
        const summoner = own ? owner : game.getOpponent(owner);
        const summoned = new Card(cardDefinition(158), summoner.id);
        const halberd = new Card(cardDefinition(168), owner.id);
        placeFieldCards(summoner.field, summoned);
        owner.hand.push(halberd);
        await game.emit("after_summon", { card: summoned, player: summoner, method, fromZone: "extraDeck" });
        const eligible = own && ["special", "fusion", "synchro", "ascension"].includes(method);
        assert.equal(owner.field.includes(halberd), eligible);
        assert.equal(halberd.cannotAttackThisTurn, eligible);
      });
    }
  }
}

test("Halberd human activation asks once and preserves the chosen position", async t => {
  const game = setup(t);
  game.player.controllerType = "human";
  const summoned = new Card(cardDefinition(158), "player");
  const halberd = new Card(cardDefinition(168), "player");
  placeFieldCards(game.player.field, summoned);
  game.player.hand.push(halberd);
  let confirmations = 0;
  game.ui.showConfirmPrompt = async () => { confirmations++; return true; };
  game.ui.showSpecialSummonPositionModal = (_card, confirm) => confirm("defense");
  await game.emit("after_summon", { card: summoned, player: game.player, method: "special", fromZone: "graveyard" });
  assert.equal(confirmations, 1);
  assert.equal(halberd.position, "defense");
  assert.equal(halberd.cannotAttackThisTurn, true);
});

for (const doubled of [false, true]) {
  test(`Judgment heals once for its own summons only (doubled=${doubled})`, async t => {
    const game = setup(t);
    const judgment = new Card(cardDefinition(170), "player");
    const existing = new Card(cardDefinition(doubled ? 171 : 158), "player");
    const revived = new Card(cardDefinition(158), "player");
    const halberd = new Card(cardDefinition(168), "player");
    placeFieldCards(game.player.field, existing);
    placeFieldCards(game.bot.field, new Card(cardDefinition(158), "bot"), new Card(cardDefinition(158), "bot"));
    game.player.hand.push(judgment, halberd);
    game.player.graveyard.push(revived);
    const gains: number[] = [];
    const order: string[] = [];
    game.on("after_summon", event => { order.push(`summon:${event.card?.id}`); });
    game.on("lp_change", event => { if ((event.lpGained ?? 0) > 0) { gains.push(required(event.lpGained)); order.push("heal"); } });
    await game.tryActivateSpell(judgment, 0, null, { owner: game.player });
    assert.ok(game.player.field.includes(revived));
    assert.ok(game.player.field.includes(halberd));
    assert.deepEqual(gains, [doubled ? 1000 : 500]);
    assert.equal(game.player.lp, doubled ? 7000 : 6500);
    assert.ok(order.indexOf("summon:158") < order.indexOf("heal"));
  });
}

for (const id of [165, 166]) {
  for (const changed of ["control", "archetype"] as const) {
    test(`${id} keeps its protection after a later ${changed} change`, async t => {
      const game = setup(t);
      const equip = new Card(cardDefinition(id), "player");
      const host = new Card(cardDefinition(158), "player");
      placeFieldCards(game.player.field, host);
      game.player.hand.push(equip);
      await game.tryActivateSpell(equip, 0, null, { owner: game.player });
      if (changed === "control") await game.transferControl(host, game.bot);
      else { host.archetype = "Other"; host.archetypes = ["Other"]; }
      const lp = game.player.lp;
      const result = await game.destroyCard(host, { cause: "battle" });
      assert.ok("destroyed" in result);
      assert.equal(result.destroyed, false);
      assert.ok(game.player.field.includes(host) || game.bot.field.includes(host));
      assert.equal(game.player.lp, id === 166 ? lp - 1000 : lp);
      assert.equal(game.bot.lp, 8000);
      if (id === 165) assert.ok(game.player.graveyard.includes(equip));
      else assert.equal(equip.equippedTo, host);
    });
  }
}

test("Crescent sends itself without destruction and removes only its own DEF", async t => {
  const game = setup(t);
  const shield = new Card(cardDefinition(165), "player");
  const host = new Card(cardDefinition(158), "player");
  placeFieldCards(game.player.field, host);
  game.player.hand.push(shield);
  const base = host.def;
  const activation = await game.tryActivateSpell(shield, 0, null, { owner: game.player });
  assert.equal(activation.success, true, activation.reason ?? undefined);
  await game.effectEngine.applyActions([{ type: "buff_stats_temp", targetRef: "self", defBoost: 300 }], { player: game.player, opponent: game.bot, source: host }, {});
  assert.equal(host.def, base + 800);
  const movements: boolean[] = [];
  game.on("card_to_grave", event => { if (event.card === shield) movements.push(event.wasDestroyed === true); });
  const result = await game.destroyCard(host, { cause: "battle" });
  assert.ok("destroyed" in result);
  assert.equal(result.destroyed, false);
  assert.deepEqual(movements, [false]);
  assert.equal(host.def, base + 300);
  assert.equal(shield.equippedTo, null);
});

test("Sunforged retains counter bonuses after an archetype change", async t => {
  const game = setup(t);
  const blade = new Card(cardDefinition(166), "player");
  const host = new Card(cardDefinition(158), "player");
  placeFieldCards(game.player.field, host);
  game.player.hand.push(blade);
  await game.tryActivateSpell(blade, 0, null, { owner: game.player });
  host.archetype = "Other";
  host.archetypes = ["Other"];
  await game.effectEngine.applyActions([{ type: "heal", amount: 1000 }], { source: host, player: game.player, opponent: game.bot }, {});
  assert.equal(blade.getCounter("solar"), 1);
  assert.deepEqual([host.atk, host.def], [2800, 2300]);
});

test("Judgment simulation heals for the selected summons, not existing monsters", () => {
  const judgment = simulationCard({ ...cardDefinition(170), instanceId: 17001 });
  const revived = simulationCard({ ...cardDefinition(158), instanceId: 15801 });
  const existing = simulationCard({ ...cardDefinition(158), instanceId: 15802 });
  const state = simulationState({ _isPerspectiveState: true, bot: { hand: [judgment], field: [existing], graveyard: [revived] }, player: { field: [simulationCard({ ...cardDefinition(158), instanceId: 15803 }), simulationCard({ ...cardDefinition(158), instanceId: 15804 })] } });
  simulateLuminarchMainPhaseAction(state, { type: "spell", index: 0, cardName: judgment.name });
  assert.equal(state.bot.lp, 6500);
  assert.ok(state.bot.field.includes(revived));
});

test("Judgment simulation caps its summons at the opponent's current monster count", () => {
  const judgment = simulationCard({ ...cardDefinition(170), instanceId: 17001 });
  const candidates = Array.from({ length: 5 }, (_, index) => simulationCard({ ...cardDefinition(158), instanceId: 15800 + index }));
  const state = simulationState({ _isPerspectiveState: true, bot: { hand: [judgment], graveyard: candidates },
    player: { field: [simulationCard({ ...cardDefinition(158), instanceId: 15810 }), simulationCard({ ...cardDefinition(158), instanceId: 15811 })] } });
  simulateLuminarchMainPhaseAction(state, { type: "spell", index: 0, cardName: judgment.name });
  assert.equal(state.bot.field.length, 2);
  assert.equal(state.bot.lp, 7000);
});

test("Judgment simulation doubles its one heal and grants one Solar Counter", () => {
  const judgment = simulationCard({ ...cardDefinition(170), instanceId: 17001 });
  const revived = simulationCard({ ...cardDefinition(158), instanceId: 15801 });
  const existing = simulationCard({ ...cardDefinition(171), instanceId: 17101 });
  const blade = simulationCard({ ...cardDefinition(166), instanceId: 16601 });
  const state = simulationState({ _isPerspectiveState: true, bot: { hand: [judgment], field: [existing], spellTrap: [blade], graveyard: [revived] }, player: { field: [simulationCard({ ...cardDefinition(158), instanceId: 15803 }), simulationCard({ ...cardDefinition(158), instanceId: 15804 })] } });
  attachSimulatedEquip(blade, existing, {});
  simulateLuminarchMainPhaseAction(state, { type: "spell", index: 0, cardName: judgment.name });
  assert.equal(state.bot.lp, 7000);
  assert.deepEqual([existing.atk, existing.def], [2700, 3200]);
});

test("Sunforged simulation uses the discount and renews its per-copy protection next turn", () => {
  const host = simulationCard({ ...cardDefinition(158), instanceId: 15801, archetype: "Other", archetypes: ["Other"], position: "attack" });
  const knight = simulationCard({ ...cardDefinition(173), instanceId: 17301 });
  const blade = simulationCard({ ...cardDefinition(166), instanceId: 16601 });
  const enemy = simulationCard({ ...cardDefinition(172), instanceId: 17201, atk: 5000, position: "attack" });
  const state = simulationState({ _isPerspectiveState: true, turnCounter: 2, bot: { field: [host, knight], spellTrap: [blade] }, player: { field: [enemy] } });
  attachSimulatedEquip(blade, host, {});
  for (const { turn, protects } of [{ turn: 2, protects: true }, { turn: 2, protects: false }, { turn: 3, protects: true }]) {
    state.turnCounter = turn;
    assert.equal(replaceSimulatedBattleDestruction(state, host) === blade, protects);
    assert.equal(state.bot.lp, 8000);
  }
});

for (const id of [165, 166]) {
  test(`${id} simulated replacement follows its host across control changes`, () => {
    const host = simulationCard({ ...cardDefinition(158), instanceId: 15801, archetype: "Other", archetypes: ["Other"] });
    const equip = simulationCard({ ...cardDefinition(id), instanceId: id * 100 });
    const state = simulationState({ _isPerspectiveState: true, bot: { spellTrap: [equip] }, player: { field: [host] } });
    attachSimulatedEquip(equip, host, id === 165 ? { defBonus: 500 } : {});
    const originalDef = host.def;
    assert.equal(replaceSimulatedBattleDestruction(state, host), equip);
    assert.equal(state.bot.lp, id === 166 ? 7000 : 8000);
    assert.equal(state.player.lp, 8000);
    if (id === 165) {
      assert.ok(state.bot.graveyard.includes(equip));
      assert.equal(host.def, required(originalDef) - 500);
      assert.equal(equip.equippedTo, null);
    }
    assert.equal(replaceSimulatedBattleDestruction(state, host), null);
  });
}

for (const impossible of [false, true]) {
  test(`Judgment resolves ${impossible ? "no" : "partial"} summons without counting stale results`, async t => {
    const game = setup(t);
    const judgment = new Card(cardDefinition(170), "player");
    const cards = [new Card(cardDefinition(158), "player"), new Card(cardDefinition(158), "player")];
    placeFieldCards(game.bot.field, new Card(cardDefinition(158), "bot"), new Card(cardDefinition(158), "bot"));
    game.player.hand.push(judgment);
    game.player.graveyard.push(...cards);
    assert.ok(game.chainSystem instanceof ChainSystem);
    game.chainSystem.offerChainResponses = async () => {
      if (game.chainSystem.getLastChainLink()?.card === judgment) {
        placeFieldCards(game.player.field, ...Array.from({ length: impossible ? 5 : 4 }, () => new Card(cardDefinition(158), "player")));
      }
      return { offers: 1, activations: 0, lastActivator: null, chainBuilt: false, consecutivePasses: 2 };
    };
    const gains: number[] = [];
    game.on("lp_change", event => { if ((event.lpGained ?? 0) > 0) gains.push(required(event.lpGained)); });
    await game.tryActivateSpell(judgment, 0, null, { owner: game.player });
    assert.deepEqual(gains, impossible ? [] : [500]);
    assert.equal(game.player.lp, impossible ? 6000 : 6500);
    assert.equal(cards.filter(card => game.player.field.includes(card)).length, impossible ? 0 : 1);
  });
}

test("a failed mandatory send cannot replace destruction", async t => {
  const game = setup(t);
  const shield = new Card(cardDefinition(165), "player");
  const host = new Card(cardDefinition(158), "player");
  placeFieldCards(game.player.field, host);
  game.player.hand.push(shield);
  await game.tryActivateSpell(shield, 0, null, { owner: game.player });
  const move = game.moveCard.bind(game);
  game.moveCard = (card, owner, zone, options) => card === shield && options?.contextLabel === "destruction_replacement"
    ? { success: false, reason: "test blocked send", rolledBack: false }
    : Reflect.apply(move, game, [card, owner, zone, options]);
  const result = await game.destroyCard(host, { cause: "battle" });
  assert.ok("destroyed" in result && result.destroyed);
});

test("Crescent cannot protect when its required GY send is redirected", async t => {
  const game = setup(t);
  const shield = new Card(cardDefinition(165), "player");
  const host = new Card(cardDefinition(158), "player");
  placeFieldCards(game.player.field, host);
  game.player.hand.push(shield);
  await game.tryActivateSpell(shield, 0, null, { owner: game.player });
  placeFieldCards(game.bot.field, new Card(cardDefinition(273), "bot"));
  const result = await game.destroyCard(host, { cause: "battle" });
  assert.ok("destroyed" in result && result.destroyed);
  assert.ok(game.player.banished.includes(shield));
});

test("simulated Crescent also loses protection when its send is redirected", () => {
  const host = simulationCard({ ...cardDefinition(158), instanceId: 15801 });
  const equip = simulationCard({ ...cardDefinition(165), instanceId: 16501 });
  const galaxy = simulationCard({ ...cardDefinition(273), instanceId: 27301 });
  const state = simulationState({ _isPerspectiveState: true, bot: { field: [host], spellTrap: [equip] }, player: { field: [galaxy] } });
  attachSimulatedEquip(equip, host, { defBonus: 500 });
  assert.equal(replaceSimulatedBattleDestruction(state, host), null);
  assert.ok(state.bot.banished.includes(equip));
  assert.equal(host.def, cardDefinition(158).def);
});

test("reattaching the same equipment does not add its bonus twice", async t => {
  const game = setup(t);
  const shield = new Card(cardDefinition(165), "player");
  const host = new Card(cardDefinition(158), "player");
  placeFieldCards(game.player.field, host);
  game.player.hand.push(shield);
  await game.tryActivateSpell(shield, 0, null, { owner: game.player });
  const equippedDef = host.def;
  await game.effectEngine.applyActions([{ type: "equip", targetRef: "host", defBonus: 500 }],
    { source: shield, player: game.player, opponent: game.bot }, { host: [host] });
  assert.equal(host.def, equippedDef);
  assert.equal(host.equips.length, 1);
});

test("Judgment counts only successful moves from a selected group", async t => {
  const game = setup(t);
  const judgment = new Card(cardDefinition(170), "player");
  const cards = [new Card(cardDefinition(158), "player"), new Card(cardDefinition(158), "player")];
  game.player.hand.push(judgment);
  game.player.graveyard.push(...cards);
  placeFieldCards(game.bot.field, new Card(cardDefinition(158), "bot"), new Card(cardDefinition(158), "bot"));
  const move = game.moveCard.bind(game);
  game.moveCard = (card, owner, zone, options) => card === cards[1] && zone === "field"
    ? { success: false, reason: "test blocked summon", rolledBack: false }
    : Reflect.apply(move, game, [card, owner, zone, options]);
  const order: string[] = [];
  game.on("after_summon", event => { if (cards.some(card => card === event.card)) order.push("summon"); });
  game.on("lp_change", event => { if ((event.lpGained ?? 0) > 0) order.push(`heal:${event.lpGained}`); });
  await game.tryActivateSpell(judgment, 0, null, { owner: game.player });
  assert.deepEqual(order, ["summon", "heal:500"]);
  assert.equal(game.player.lp, 6500);
  assert.ok(game.player.graveyard.includes(required(cards[1])));
});

for (const id of [165, 166]) {
  for (const invalid of ["control", "archetype", "facedown", "departure"] as const) {
    test(`${id} revalidates its equip target at resolution (${invalid})`, async t => {
      const game = setup(t);
      const equip = new Card(cardDefinition(id), "player");
      const host = new Card(cardDefinition(158), "player");
      placeFieldCards(game.player.field, host);
      game.player.hand.push(equip);
      assert.ok(game.chainSystem instanceof ChainSystem);
      let changed = false;
      game.chainSystem.offerChainResponses = async () => {
        if (game.chainSystem.getLastChainLink()?.card === equip && !changed) {
          changed = true;
          if (invalid === "control") await game.transferControl(host, game.bot);
          if (invalid === "archetype") { host.archetype = "Other"; host.archetypes = ["Other"]; }
          if (invalid === "facedown") host.isFacedown = true;
          if (invalid === "departure") await game.moveCard(host, game.player, "hand", { fromZone: "field", awaitEvents: true });
        }
        return { offers: 1, activations: 0, lastActivator: null, chainBuilt: false, consecutivePasses: 2 };
      };
      let equippedEvents = 0;
      game.on("card_equipped", () => { equippedEvents++; });
      await game.tryActivateSpell(equip, 0, null, { owner: game.player });
      assert.equal(equippedEvents, 0);
      assert.equal(equip.equippedTo, null);
      assert.ok(game.player.graveyard.includes(equip));
    });
  }
}

test("Judgment human chooses one of two candidates with minimum one", async t => {
  const game = setup(t);
  game.player.controllerType = "human";
  const judgment = new Card(cardDefinition(170), "player");
  const cards = [new Card(cardDefinition(158), "player"), new Card(cardDefinition(154), "player")];
  placeFieldCards(game.bot.field, new Card(cardDefinition(158), "bot"), new Card(cardDefinition(158), "bot"));
  game.player.hand.push(judgment);
  game.player.graveyard.push(...cards);
  let choices = 0;
  game.ui.showTargetSelection = (contract, confirm) => {
    choices++;
    const requirement = required(required(required(contract).requirements)[0]);
    assert.equal(requirement.min, 1);
    assert.equal(requirement.max, 2);
    const chosen = required(requirement.candidates.find(candidate => candidate.cardRef === cards[1]));
    setImmediate(() => required(confirm)({ [requirement.id]: [chosen.key] }));
    return { close() {} };
  };
  game.ui.showSpecialSummonPositionModal = (_card, confirm) => confirm("defense");
  await game.tryActivateSpell(judgment, 0, null, { owner: game.player });
  assert.equal(choices, 1);
  assert.deepEqual(game.player.field, [cards[1]]);
  assert.equal(game.player.lp, 6500);
});

test("Sunforged counts gain occurrences only and detaches without retaining its bonus", async t => {
  const game = setup(t);
  const blade = new Card(cardDefinition(166), "player");
  const host = new Card(cardDefinition(158), "player");
  placeFieldCards(game.player.field, host);
  game.player.hand.push(blade);
  await game.tryActivateSpell(blade, 0, null, { owner: game.player });
  const base = [host.atk, host.def];
  const ctx = { source: host, player: game.player, opponent: game.bot };
  for (const amount of [100, 1000, 0]) await game.effectEngine.applyActions([{ type: "heal", amount }], ctx, {});
  await game.effectEngine.applyActions([{ type: "pay_lp", amount: 1000 }], ctx, {});
  await game.effectEngine.applyActions([{ type: "heal", amount: 1000, player: "opponent" }], ctx, {});
  assert.equal(blade.getCounter("solar"), 2);
  assert.deepEqual([host.atk, host.def], base.map(value => value + 400));
  await game.moveCard(blade, game.player, "graveyard", { fromZone: "spellTrap", awaitEvents: true });
  assert.deepEqual([host.atk, host.def], base);
  assert.equal(blade.equippedTo, null);
});

for (const accept of [false, true]) {
  test(`Sunforged human ${accept ? "accepts" : "declines"} discounted protection`, async t => {
    const game = setup(t);
    const blade = new Card(cardDefinition(166), "player");
    const host = new Card(cardDefinition(158), "player");
    const knight = new Card(cardDefinition(173), "player");
    placeFieldCards(game.player.field, host, knight);
    game.player.hand.push(blade);
    await game.tryActivateSpell(blade, 0, null, { owner: game.player });
    // Bind the intended host when the fixture has two legal AI targets.
    if (blade.equippedTo !== host) await game.effectEngine.applyEquip({ type: "equip", targetRef: "host" }, { source: blade, player: game.player, opponent: game.bot }, { host: [host] });
    game.player.controllerType = "human";
    let prompts = 0;
    game.ui.showConfirmPrompt = async () => { prompts++; return accept; };
    const result = await game.destroyCard(host, { cause: "battle" });
    assert.ok("destroyed" in result);
    assert.equal(result.destroyed, !accept);
    assert.equal(prompts, 1);
    assert.equal(game.player.lp, 8000);
    assert.equal(game.canUseOncePerTurn(knight, game.player, required(knight.effects[1])).remaining, accept ? 1 : 2);
    if (accept) {
      await game.destroyCard(host, { cause: "battle" });
      assert.ok(game.player.graveyard.includes(host));
      assert.equal(prompts, 1);
    }
  });
}

test("optional zero summons clear prior summon results in runtime and simulation", async t => {
  const game = setup(t);
  const source = new Card(cardDefinition(170), "player");
  const stale = new Card(cardDefinition(158), "player");
  const ctx = { source, player: game.player, opponent: game.bot, lastSpecialSummonedCards: [stale], lastSpecialSummonedCard: stale };
  await game.effectEngine.applyActions([{ type: "special_summon_from_zone", zone: "graveyard", count: { min: 0, max: 1 } }], ctx, {});
  assert.deepEqual(ctx.lastSpecialSummonedCards, []);
  assert.equal(ctx.lastSpecialSummonedCard, null);
  const state = simulationState();
  const options = { actionContext: { lastSpecialSummonedCards: [simulationCard(cardDefinition(158))] } };
  applySimulatedActions({ state, options, actions: [{ type: "special_summon_from_zone", zone: "graveyard", count: { min: 0, max: 1 } }, { type: "heal", amountFromContext: { key: "lastSpecialSummonedCards.length", multiplier: 500 } }] });
  assert.equal(state.bot.lp, 8000);
});

for (const method of ["normal", "special", "fusion", "synchro", "ascension"] as const) {
  for (const own of [false, true]) {
    test(`Halberd simulated event ${method} on ${own ? "own" : "opponent"} field`, () => {
      const source = simulationCard({ ...cardDefinition(158), instanceId: 15801 });
      const copies = [1, 2].map(instanceId => simulationCard({ ...cardDefinition(168), instanceId }));
      const state = simulationState({ _isPerspectiveState: true, bot: { hand: [...copies] } });
      const owner = own ? state.bot : state.player;
      placeSimulationCards(owner.field, source);
      const events = attachSimulatedEventEmitter(state, { enableSimulatedEvents: true });
      required(events.emitSimulatedEvent)("after_summon", { card: source, player: owner, method });
      const expected = own && method !== "normal";
      for (const copy of copies) {
        assert.equal(state.bot.field.includes(copy), expected);
        if (expected) assert.equal(copy.cannotAttackThisTurn, true);
      }
    });
  }
}
