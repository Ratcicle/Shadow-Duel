import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import Card from "../../src/core/Card.js";
import { createRuntimeGame } from "../helpers/game.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import { canUseSimulatedEffectUsage } from "../../src/core/ai/common/simStateUtils.js";
import { getPiercingDamage } from "../../src/core/ai/common/cardStats.js";
import type { AiStateShape } from "../../src/core/contracts/aiState.js";
import assert from "node:assert/strict";
import test from "node:test";

import { greedySearchWithEvalV2 } from "../../src/core/ai/BeamSearch.js";
import { fixtureGameTreeSearch as gameTreeSearch } from "../helpers/gameTree.js";
import { turnLineSearch } from "../../src/core/ai/TurnLineSearch.js";
import { cloneBotGameState } from "../../src/core/bot/simulationBridge.js";
import { fingerprintPlanningState } from "../../src/core/ai/common/stateFingerprint.js";
import { processSimulatedDelayedActions } from "../../src/core/ai/common/simulatedActions/lifecycle.js";
import { detachSimulatedEquip } from "../../src/core/ai/common/zones.js";
import { destroySimulatedCard, replaceSimulatedBattleDestruction } from "../../src/core/ai/common/simulatedActions/destruction.js";
import { placeFieldCards } from "../helpers/game.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";

type BotCloneCard = Parameters<typeof cloneBotGameState>[0]["hand"][number];

function makePlayer(id: "player" | "bot") {
  const nested = { stats: ["atk"] };
  const card: Partial<BotCloneCard> = {
    id: id === "bot" ? 101 : 201,
    name: `${id} card`,
    cardKind: "monster" as const,
    atk: 1200,
    def: 800,
  };
  Reflect.set(card, "nested", nested);
  return {
    id,
    lp: id === "bot" ? 7600 : 6400,
    hand: [card as BotCloneCard],
    field: [],
    graveyard: [],
    deck: [],
    extraDeck: [],
    banished: [],
    fieldSpell: null,
    spellTrap: [],
    summonCount: 1,
    additionalNormalSummons: 2,
    controllerType: "ai",
  };
}

interface CloneCardProbe {
  nested: { stats: string[] };
  counters: Map<string, number>;
  turnBasedBuffs: Array<{
    id: string;
    stat: "atk";
    value: number;
    expiresOnTurn: number;
  }>;
  equippedTo: object | null;
  equipTarget: object | null;
  equips: object[];
}

interface ClonePlayerProbe {
  lp: number;
  hand: CloneCardProbe[];
  additionalNormalSummonPermissions?: object[];
}

interface CloneStateProbe {
  bot: ClonePlayerProbe;
  player: ClonePlayerProbe;
  _gameRef?: object;
  _simOncePerTurn?: { bot?: Map<string, number> };
  _simLuminarch?: { milestones?: string[] };
  temporaryEventEffects?: Array<{ nested: { active: boolean } }>;
}

function requireCloneState(value: unknown): CloneStateProbe {
  assert.ok(value && typeof value === "object");
  const bot = Reflect.get(value, "bot");
  const player = Reflect.get(value, "player");
  assert.ok(bot && typeof bot === "object");
  assert.ok(player && typeof player === "object");
  return value as CloneStateProbe;
}

function makeCloneProfilePlayer(id: "player" | "bot") {
  const attachment = {
    id: id === "bot" ? 102 : 202,
    name: `${id} equipment`,
    cardKind: "spell" as const,
  };
  const card = {
    id: id === "bot" ? 101 : 201,
    name: `${id} card`,
    cardKind: "monster" as const,
    atk: 1200,
    def: 800,
    nested: { stats: ["atk"] },
    counters: new Map([["charge", 2]]),
    turnBasedBuffs: [
      {
        id: "profile-buff",
        stat: "atk" as const,
        value: 300,
        expiresOnTurn: 8,
      },
    ],
    equippedTo: attachment,
    equipTarget: attachment,
    equips: [attachment],
  };
  return {
    id,
    name: id,
    lp: id === "bot" ? 7600 : 6400,
    hand: [card],
    field: [],
    graveyard: [],
    deck: [],
    extraDeck: [],
    banished: [],
    fieldSpell: null,
    spellTrap: [],
    summonCount: 1,
    additionalNormalSummons: 2,
    additionalNormalSummonPermissions: [],
    normalSummonsThisTurn: [],
    specialSummonRestrictions: [],
    effectActivationRestrictions: [],
    controllerType: "ai" as const,
  };
}

function makeCloneProfileGame() {
  return {
    bot: makeCloneProfilePlayer("bot"),
    player: makeCloneProfilePlayer("player"),
    turn: "bot" as "bot" | "player",
    phase: "main1" as const,
    turnCounter: 7,
    _simOncePerTurn: { bot: new Map([["probe", 2]]) },
    _simLuminarch: { milestones: ["opening"] },
    temporaryEventEffects: [
      { event: "profile-probe", nested: { active: true } },
    ],
  };
}

const CLONE_PROBE_ACTION = {
  type: "position_change" as const,
  fieldIndex: 0,
  toPosition: "attack" as const,
  priority: 1,
};

test("bot perspective clone preserves its legacy key order and aliasing profile", () => {
  const bot = makePlayer("bot");
  const opponent = makePlayer("player");
  const usedThisTurn = new Map([["probe", 2]]);
  const game = {
    player: opponent,
    bot,
    turn: "bot",
    phase: "main1",
    turnCounter: 7,
    effectEngine: { usedThisTurn },
  };
  const botPort = {
    ...bot,
    resolveOpponent: () => opponent,
    strategy: {
      simulateMainPhaseAction: () => undefined,
      simulateSpellEffect: () => undefined,
    },
  };

  const clone = cloneBotGameState(botPort, game);

  assert.deepEqual(Object.keys(clone), [
    "player",
    "bot",
    "turn",
    "phase",
    "turnCounter",
    "_isPerspectiveState",
    "_gameRef",
    "usedThisTurn",
  ]);
  assert.deepEqual(Object.keys(clone.bot), [
    "id",
    "lp",
    "hand",
    "field",
    "graveyard",
    "deck",
    "extraDeck",
    "banished",
    "fieldSpell",
    "spellTrap",
    "summonCount",
    "additionalNormalSummons",
    "controllerType",
  ]);
  assert.equal(clone._isPerspectiveState, true);
  assert.equal(clone._gameRef, game);
  assert.notEqual(clone.bot, bot);
  assert.notEqual(clone.bot.hand, bot.hand);
  assert.notEqual(clone.bot.hand[0], bot.hand[0]);
  assert.equal(
    Reflect.get(clone.bot.hand[0]!, "nested"),
    Reflect.get(bot.hand[0]!, "nested"),
  );
  assert.notEqual(clone.usedThisTurn, usedThisTurn);
  assert.ok(clone.usedThisTurn);
  assert.deepEqual([...clone.usedThisTurn], [["probe", 2]]);
});

test("Beam/Greedy clone isolates planning resources and links but keeps unrelated legacy aliases", async () => {
  const game = makeCloneProfileGame();
  let captured: unknown;
  const strategy = {
    generateMainPhaseActions: () => [CLONE_PROBE_ACTION],
    simulateMainPhaseAction(state: unknown) {
      const clone = requireCloneState(state);
      captured ??= clone;
      clone.bot.lp -= 1;
    },
    evaluateBoardV2: (state: unknown) => requireCloneState(state).bot.lp,
    evaluateBoard: (state: unknown) => requireCloneState(state).bot.lp,
  };

  const result = await greedySearchWithEvalV2(game, strategy, {
    preGeneratedActions: [CLONE_PROBE_ACTION],
  });
  const clone = requireCloneState(captured);
  const sourceCard = required(game.bot.hand[0]);
  const clonedCard = required(clone.bot.hand[0]);

  assert.ok(result);
  assert.equal(clone._gameRef, game);
  assert.notEqual(clone.bot, game.bot);
  assert.notEqual(clonedCard, sourceCard);
  assert.equal(clonedCard.nested, sourceCard.nested);
  assert.notEqual(clonedCard.counters, sourceCard.counters);
  assert.notEqual(clonedCard.turnBasedBuffs, sourceCard.turnBasedBuffs);
  assert.notEqual(clonedCard.turnBasedBuffs[0], sourceCard.turnBasedBuffs[0]);
  // Equipment movement edits the host: retaining the live link contaminated
  // siblings. The cloned graph now preserves its links within the branch.
  assert.notEqual(clonedCard.equippedTo, sourceCard.equippedTo);
  assert.notEqual(clonedCard.equips, sourceCard.equips);
  assert.notEqual(clonedCard.equips[0], sourceCard.equips[0]);
  assert.equal(clonedCard.equips[0], clonedCard.equippedTo);
  assert.notEqual(
    clone.bot.additionalNormalSummonPermissions,
    game.bot.additionalNormalSummonPermissions,
  );
  // OPT consumers need the previous depth's count; omission reopened effects.
  assert.notEqual(clone._simOncePerTurn, game._simOncePerTurn);
  assert.notEqual(clone._simOncePerTurn?.bot, game._simOncePerTurn.bot);
  assert.deepEqual([...required(clone._simOncePerTurn?.bot)], [["probe", 2]]);

  clonedCard.counters.set("charge", 9);
  assert.equal(sourceCard.counters.get("charge"), 2);
});

test("GameTree copies simulation zones and graph links without reading the external game", () => {
  const game = makeCloneProfileGame();
  let captured: unknown;
  const strategy = {
    simulateMainPhaseAction: () => undefined,
    generateMainPhaseActions(state: unknown) {
      captured ??= state;
      return [CLONE_PROBE_ACTION];
    },
  };

  gameTreeSearch(game, strategy, game.bot, 1);
  const clone = requireCloneState(captured);
  const sourceCard = required(game.bot.hand[0]);
  const clonedCard = required(clone.bot.hand[0]);

  assert.equal(clone._gameRef, game);
  assert.notEqual(clone.bot, game.bot);
  assert.notEqual(clonedCard, sourceCard);
  assert.equal(Object.hasOwn(clonedCard, "nested"), false); // no simulator consumer
  assert.notEqual(clonedCard.counters, sourceCard.counters);
  assert.notEqual(clonedCard.turnBasedBuffs, sourceCard.turnBasedBuffs);
  assert.notEqual(clonedCard.turnBasedBuffs[0], sourceCard.turnBasedBuffs[0]);
  assert.notEqual(clonedCard.equippedTo, sourceCard.equippedTo);
  assert.notEqual(clonedCard.equipTarget, sourceCard.equipTarget);
  assert.notEqual(clonedCard.equips, sourceCard.equips);
  assert.notEqual(clonedCard.equips[0], sourceCard.equips[0]);
  assert.equal(Object.hasOwn(clone.bot, "deck"), true);
  assert.equal(Object.hasOwn(clone.bot, "banished"), true);
  assert.equal(
    Object.hasOwn(clone.bot, "additionalNormalSummonPermissions"),
    true,
  );

  clonedCard.counters.set("charge", 9);
  assert.equal(sourceCard.counters.get("charge"), 2);
});

test("TurnLine clone deep-isolates planning cards and copied simulation metadata", async () => {
  const game = makeCloneProfileGame();
  let captured: unknown;
  const strategy = {
    generateMainPhaseActions: () => [CLONE_PROBE_ACTION],
    simulateMainPhaseAction(state: unknown) {
      const clone = requireCloneState(state);
      captured ??= clone;
      clone.bot.lp -= 1;
    },
    evaluateBoardV2: (state: unknown) => -requireCloneState(state).bot.lp,
  };

  const result = await turnLineSearch(game, strategy, {
    beamWidth: 1,
    maxDepth: 1,
    nodeBudget: 2,
  });
  const clone = requireCloneState(captured);
  const sourceCard = required(game.bot.hand[0]);
  const clonedCard = required(clone.bot.hand[0]);

  assert.ok(result);
  assert.equal(clone._gameRef, game);
  assert.notEqual(clone.bot, game.bot);
  assert.notEqual(clonedCard, sourceCard);
  assert.notEqual(clonedCard.nested, sourceCard.nested);
  assert.notEqual(clonedCard.counters, sourceCard.counters);
  assert.notEqual(clonedCard.equippedTo, sourceCard.equippedTo);
  assert.notEqual(clonedCard.equips, sourceCard.equips);
  assert.notEqual(clonedCard.equips[0], sourceCard.equips[0]);
  assert.notEqual(
    clone.bot.additionalNormalSummonPermissions,
    game.bot.additionalNormalSummonPermissions,
  );
  assert.notEqual(clone._simOncePerTurn, game._simOncePerTurn);
  assert.notEqual(clone._simOncePerTurn?.bot, game._simOncePerTurn.bot);
  assert.deepEqual([...clone._simOncePerTurn!.bot!], [["probe", 2]]);
  assert.notEqual(clone._simLuminarch, game._simLuminarch);
  assert.notEqual(
    clone._simLuminarch?.milestones,
    game._simLuminarch.milestones,
  );
  assert.notEqual(clone.temporaryEventEffects, game.temporaryEventEffects);
  assert.notEqual(
    required(clone.temporaryEventEffects?.[0]).nested,
    required(game.temporaryEventEffects[0]).nested,
  );

  clonedCard.nested.stats.push("def");
  clonedCard.counters.set("charge", 9);
  clone._simLuminarch?.milestones?.push("follow-up");
  assert.deepEqual(sourceCard.nested.stats, ["atk"]);
  assert.equal(sourceCard.counters.get("charge"), 2);
  assert.deepEqual(game._simLuminarch.milestones, ["opening"]);
});

const CLONE_PROFILES = ["bot", "beamGreedy", "gameTree", "turnLine"] as const;
for (const profile of CLONE_PROFILES) {
  for (const actor of ["bot", "player"] as const) {
    test(`${profile} preserves activation cases and isolates their LP cost and parent usage (${actor})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
      t.after(() => game.dispose("activation_case_clone_test"));
      game.turn = actor; game.phase = "main1"; game.turnCounter = 3;
      const self = game[actor]; const opponent = game[actor === "bot" ? "player" : "bot"];
      const source = new Card(cardDefinition(312), actor); const recruit = new Card(cardDefinition(307), actor);
      self.fieldSpell = source; self.deck.push(recruit);
      let captured: unknown;
      const strategy = {
        bot: self,
        generateMainPhaseActions(state: unknown) { if (profile === "gameTree") captured ??= state; return [CLONE_PROBE_ACTION]; },
        simulateMainPhaseAction(state: unknown) { captured ??= state; requireCloneState(state).bot.lp += 1; },
        simulateSpellEffect: () => undefined,
        evaluateBoardV2: (state: unknown) => requireCloneState(state).bot.lp,
        evaluateBoard: (state: unknown) => requireCloneState(state).bot.lp,
      };
      if (profile === "bot") {
        captured = cloneBotGameState(unsafeFixture<Parameters<typeof cloneBotGameState>[0]>(
          { ...self, strategy, resolveOpponent: () => opponent }, "Minimal Bot clone actor with live activation-mode source"),
        unsafeFixture<Parameters<typeof cloneBotGameState>[1]>(game, "Live Game exposes canonical activation data"));
      } else if (profile === "beamGreedy") await greedySearchWithEvalV2(game, strategy, { preGeneratedActions: [CLONE_PROBE_ACTION] });
      else if (profile === "gameTree") gameTreeSearch(game, { ...strategy, bot: { debug: false } }, self, 1);
      else await turnLineSearch(unsafeFixture<Parameters<typeof turnLineSearch>[0]>(game, "Live Game provides this profile's fields"),
        strategy, { maxDepth: 1, beamWidth: 1, nodeBudget: 2 });
      const state = unsafeFixture<Parameters<typeof applyGenericSimulatedMainPhaseAction>[0]>(required(captured), "Captured planner clone has the simulation brand");
      const clonedSource = required(state.bot.fieldSpell);
      const effect = required(clonedSource.effects?.find(entry => entry.id === "arcanist_grand_library_ignition"));
      assert.deepEqual(effect.activationCases, source.effects.find(entry => entry.id === effect.id)?.activationCases);
      const beforeLp = state.bot.lp;
      applyGenericSimulatedMainPhaseAction(state, { type: "fieldEffect", cardId: 312,
        activationContext: { decisions: { cases: { [effect.id]: "arcanist_grand_library_summon" } } } });
      assert.equal(state.bot.lp, beforeLp - 2000);
      assert.equal(state.bot.field[0]?.instanceId, recruit.instanceId);
      assert.equal(canUseSimulatedEffectUsage(state, effect, clonedSource), false);
      assert.equal(self.lp, 8000);
      assert.deepEqual(self.deck, [recruit]);
      assert.equal(game.canUseOncePerTurn(source, self, effect).ok, true);
    });
  }
}
for (const profile of CLONE_PROFILES) {
  test(`${profile} copies a live bound protection with isolated consumption and presence`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose("replacement_clone_test"));
    game.turn = "bot"; game.phase = "main1"; game.turnCounter = 3;
    const host = new Card(cardDefinition(302), "bot"); const source = new Card(cardDefinition(310), "bot");
    placeFieldCards(game.bot.field, host);
    await game.effectEngine.applyActions([{ type: "register_replacement_effect", targetRef: "host", uses: 1,
      duration: "end_of_next_turn", replacementEffect: { type: "destruction", reason: "any", targetOwner: "self", targetZones: ["field"] } }],
    { source, player: game.bot, opponent: game.player }, { host: [host] });
    let captured: unknown;
    const strategy = {
      bot: game.bot,
      generateMainPhaseActions(state: unknown) { if (profile === "gameTree") captured ??= state; return [CLONE_PROBE_ACTION]; },
      simulateMainPhaseAction(state: unknown) { captured ??= state; requireCloneState(state).bot.lp += 1; },
      simulateSpellEffect: () => undefined,
      evaluateBoardV2: (state: unknown) => requireCloneState(state).bot.lp,
      evaluateBoard: (state: unknown) => requireCloneState(state).bot.lp,
    };
    if (profile === "bot") {
      captured = cloneBotGameState(unsafeFixture<Parameters<typeof cloneBotGameState>[0]>(
        { ...game.bot, strategy, resolveOpponent: () => game.player }, "Minimal Bot clone actor with live card zones"),
      unsafeFixture<Parameters<typeof cloneBotGameState>[1]>(game, "Live Game supplies the registered replacement"));
    } else if (profile === "beamGreedy") await greedySearchWithEvalV2(game, strategy, { preGeneratedActions: [CLONE_PROBE_ACTION] });
    else if (profile === "gameTree") gameTreeSearch(game, { ...strategy, bot: { debug: false } }, game.bot, 1);
    else await turnLineSearch(unsafeFixture<Parameters<typeof turnLineSearch>[0]>(game, "Live Game supplies public replacement metadata"),
      strategy, { maxDepth: 1, beamWidth: 1, nodeBudget: 2 });
    const state = unsafeFixture<Parameters<typeof destroySimulatedCard>[3]>(required(captured), "Captured planner clone has the simulation brand");
    const clonedHost = required(state.bot.field[0]); const registration = required(state._simReplacementEffects?.[0]);
    assert.equal(registration.usesRemaining, 1); assert.equal(registration.expiresOnTurn, 4);
    const before = fingerprintPlanningState(state);
    assert.ok(replaceSimulatedBattleDestruction(state, clonedHost));
    assert.notEqual(fingerprintPlanningState(state), before);
    assert.equal(destroySimulatedCard(clonedHost, state.bot, state.player, state, {}), true);
    assert.ok(game.bot.field.includes(host));
    const liveRegistration = required(game.temporaryReplacementEffects[0]);
    assert.equal(Reflect.get(liveRegistration, "usesRemaining"), 1);
  });
}
for (const profile of CLONE_PROFILES) {
  test(`${profile} preserves the inactive equip contribution without subtracting other attacks`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose("equip_clone_test"));
    game.turn = "bot";
    game.phase = "main1";
    const host = new Card({ id: 99881, name: "Clone host", cardKind: "monster", extraAttacks: 2 }, "bot");
    const equip = new Card(cardDefinition(11), "bot");
    placeFieldCards(game.bot.field, host);
    placeFieldCards(game.bot.spellTrap, equip);
    assert.equal(await game.effectEngine.applyEquip({ type: "equip", targetRef: "host", extraAttacks: 1 },
      { source: equip, player: game.bot, opponent: game.player }, { host: [host] }), true);
    await game.effectEngine.applyActions([
      { type: "add_status", status: "effectsNegated", targetRef: "equip", duration: "while_faceup" },
    ], { source: equip, player: game.bot, opponent: game.player }, { equip: [equip] });
    assert.equal(game.getMonsterAttackLimit(host), 3);
    let captured: unknown;
    const strategy = {
      bot: game.bot,
      generateMainPhaseActions(state: unknown) {
        if (profile === "gameTree") captured ??= state;
        return [CLONE_PROBE_ACTION];
      },
      simulateMainPhaseAction(state: unknown) { captured ??= state; requireCloneState(state).bot.lp += 1; },
      simulateSpellEffect: () => undefined,
      evaluateBoardV2: (state: unknown) => requireCloneState(state).bot.lp,
      evaluateBoard: (state: unknown) => requireCloneState(state).bot.lp,
    };
    if (profile === "bot") {
      captured = cloneBotGameState(unsafeFixture<Parameters<typeof cloneBotGameState>[0]>(
        { ...game.bot, strategy, resolveOpponent: () => game.player },
        "Concrete equipped cards with a minimal AI strategy for clone regression"),
      unsafeFixture<Parameters<typeof cloneBotGameState>[1]>(game,
        "Live Game supplies the complete clone source without a legacy EffectEngine usage map"));
    } else if (profile === "beamGreedy") {
      await greedySearchWithEvalV2(game, strategy, { preGeneratedActions: [CLONE_PROBE_ACTION] });
    } else if (profile === "gameTree") {
      gameTreeSearch(game, { ...strategy, bot: { debug: false } }, game.bot, 1);
    } else {
      await turnLineSearch(unsafeFixture<Parameters<typeof turnLineSearch>[0]>(game,
        "Live Game has no temporary battle registrations in this fixture"), strategy,
      { maxDepth: 1, beamWidth: 1, nodeBudget: 2 });
    }
    const state = unsafeFixture<AiStateShape>(required(captured), "The profile captured a canonical simulation projection");
    const clonedHost = required(state.bot.field[0]);
    const clonedEquip = required(state.bot.spellTrap[0]);
    assert.equal(clonedEquip.equippedTo, clonedHost);
    assert.deepEqual(clonedEquip.effectsNegationContributions, equip.effectsNegationContributions);
    assert.notEqual(clonedEquip.effectsNegationContributions, equip.effectsNegationContributions);
    const clonedNegation = required(clonedEquip.effectsNegationContributions?.[0]);
    assert.notEqual(clonedNegation, equip.effectsNegationContributions[0]);
    clonedNegation.duration = "until_end_turn";
    assert.equal(equip.effectsNegationContributions[0]?.duration, "while_faceup");
    detachSimulatedEquip(clonedEquip);
    assert.equal(clonedHost.extraAttacks, 2);
    assert.equal(host.extraAttacks, 2);
    assert.equal(equip.equippedTo, host, "Detach in a branch must not change the live equip");
  });
}
for (const profile of CLONE_PROFILES) {
  for (const actor of ["bot", "player"] as const) {
    test(`${profile} keeps delayed destruction's source player inside the branch (${actor})`, async () => {
      const game = makeCloneProfileGame();
      game.turn = actor;
      const self = game[actor];
      const opponent = game[actor === "bot" ? "player" : "bot"];
      const target = required(self.hand[0]);
      // Runtime Player.game is intentionally cyclic. Void Conjurer produces
      // this delayed payload through scheduleDelayedAction after its summon.
      Object.assign(self, { game });
      Object.assign(game, { delayedActions: [{ id: "conjurer_cleanup", actionType: "delayed_destroy",
        triggerCondition: { phase: "end", player: actor }, scheduledTurn: 7, priority: 0,
        payload: { card: target, owner: actor, sourceCard: target, sourcePlayer: self } }] });
      assert.doesNotThrow(() => fingerprintPlanningState(game));
      let captured: unknown;
      const strategy = {
        bot: self,
        generateMainPhaseActions(state: unknown) {
          if (profile === "gameTree") captured ??= state;
          return [CLONE_PROBE_ACTION];
        },
        simulateMainPhaseAction(state: unknown) { captured ??= state; requireCloneState(state).bot.lp += 1; },
        simulateSpellEffect: () => undefined,
        evaluateBoardV2: (state: unknown) => requireCloneState(state).bot.lp,
        evaluateBoard: (state: unknown) => requireCloneState(state).bot.lp,
      };
      if (profile === "bot") {
        const bot = Object.assign(self, { resolveOpponent: () => opponent, strategy });
        captured = cloneBotGameState(unsafeFixture<Parameters<typeof cloneBotGameState>[0]>(bot,
          "Fixture uses the same Player identity as the delayed runtime payload"), game);
      } else if (profile === "beamGreedy") {
        await greedySearchWithEvalV2(game, unsafeFixture<Parameters<typeof greedySearchWithEvalV2>[1]>(strategy,
          "Partial strategy provides the real source player identity"), { preGeneratedActions: [CLONE_PROBE_ACTION] });
      } else if (profile === "gameTree") gameTreeSearch(game, { ...strategy, bot: { debug: false } }, self, 1);
      else await turnLineSearch(game, strategy, { beamWidth: 1, maxDepth: 1, nodeBudget: 2 });
      const clone = unsafeFixture<AiStateShape>(required(captured), "Captured profile state is the canonical simulation projection");
      const entry = required(clone.delayedActions?.[0]);
      assert.equal(entry.actionType, "delayed_destroy");
      const payload = Reflect.get(entry, "payload");
      assert.equal(Reflect.get(payload, "sourcePlayer"), clone.bot);
      assert.equal(Reflect.get(payload, "card"), clone.bot.hand[0]);
      assert.equal(Reflect.get(clone.bot, "game"), undefined);
      assert.doesNotThrow(() => fingerprintPlanningState(clone));
      assert.equal(Reflect.get(self, "game"), game, "the live graph remains unchanged");
    });
  }
}

test("a due delayed destruction uses shared sequential movement", () => {
  const game = makeCloneProfileGame();
  const target = required(game.bot.hand[0]);
  Object.assign(game.bot, { field: [target], hand: [] });
  Object.assign(game, { delayedActions: [{ id: "destroy", actionType: "delayed_destroy",
    triggerCondition: { phase: "end", player: "bot" }, scheduledTurn: 7, priority: 0,
    payload: { card: target, owner: "bot", sourceCard: null, sourcePlayer: game.player } }] });
  const state = unsafeFixture<Parameters<typeof processSimulatedDelayedActions>[0]>(game,
    "Runtime-shaped delayed_destroy fixture supplies the simulation state normally established by the clone");
  const projectedTarget = required(state.bot.field[0]);
  const events: string[] = [];
  assert.doesNotThrow(() => processSimulatedDelayedActions(state, "end", "bot", {
    emitSimulatedEvent: event => { events.push(event); },
  }));
  assert.equal(state.bot.field.length, 0);
  assert.ok(state.bot.graveyard.includes(projectedTarget));
  assert.deepEqual(events, ["card_to_grave", "card_moved"]);
  assert.deepEqual(state.delayedActions, []);
});
for (const profile of CLONE_PROFILES) {
  for (const actor of ["bot", "player"] as const) {
    test(`${profile} preserves Tech-Zero planning resources for physical ${actor}`, async () => {
      const game = makeCloneProfileGame();
      game.turn = actor;
      const physicalSelf = game[actor];
      Object.assign(physicalSelf, { debug: false });
      const physicalOpponent = game[actor === "bot" ? "player" : "bot"];
      const source = required(physicalSelf.hand[0]);
      const cardState = {
        instanceId: "sim:token:7",
        isToken: true,
        level: 1,
        baseLevel: 3,
        originalLevel: 3,
        isTuner: true,
        synchroMaterialRoles: [{ role: "non_tuner", synchroFilter: { archetype: "Tech-Zero" } }],
        effectsNegated: true,
        effectsNegatedDuration: "while_faceup",
        properSummonEstablished: true,
        properSummonProcedure: "synchro",
        banishWhenLeavesField: true,
        cannotAttackDirectly: true,
        attacksUsedThisTurn: 1,
        extraAttacks: 2,
        protectionEffects: [{ kind: "effect_destruction", expiresOnTurn: 8 }],
        oncePerTurnUsageByName: { instance_effect: { turn: 7, count: 1 } },
        turnBasedBuffs: [{ id: "level-adjust", stat: "level", value: -2, expiresOnTurn: 7 }],
      };
      Object.assign(source, cardState);
      const playerState = {
        forbidDirectAttacksThisTurn: true,
        oncePerTurnUsageByName: { shared_effect: { turn: 7, count: 1 } },
        specialSummonRestrictions: [{ allowedFilters: { archetype: "Tech-Zero" }, expiresOnTurn: 7 }],
      };
      Object.assign(physicalSelf, playerState);
      Object.assign(game, {
        usedThisTurn: new Map([[`${actor}:persisted`, 7]]),
        _simOncePerTurn: { [actor]: new Map([["shared_effect", 1]]) },
        _simPassiveOncePerTurn: new Map([[`${actor}:passive`, 1]]),
        _simUnsupportedActions: [],
        _simGeneratedInstanceCounter: 7,
        _simRequiresReplan: false,
        _simUnknownDrawCount: 1,
        pendingSynchroMaterialFollowups: [{ id: "followup", type: "synchro_material_followup", synchroSummonContextId: "summon:1", ownerId: actor, source,
          sourceName: source.name, sourceCardId: source.id, sourceInstanceId: "sim:token:7", sourceEffectId: "followup", actions: [] }],
        delayedActions: [{ id: "return", actionType: "delayed_summon", triggerCondition: { phase: "standby", player: actor },
          payload: { summons: [{ card: source, owner: actor, placementActorId: actor, fromZone: "banished", statusesOnSummon: null, summonMethod: "special", summonProcedure: null }] },
          scheduledTurn: 7, priority: 1 }],
      });
      let captured: unknown;
      const strategy = {
        bot: physicalSelf,
        generateMainPhaseActions(state: unknown) {
          if (profile === "gameTree") captured ??= state;
          return [CLONE_PROBE_ACTION];
        },
        simulateMainPhaseAction(state: unknown) {
          captured ??= state;
          requireCloneState(state).bot.lp += 1;
        },
        simulateSpellEffect: () => undefined,
        evaluateBoardV2: (state: unknown) => requireCloneState(state).bot.lp,
        evaluateBoard: (state: unknown) => requireCloneState(state).bot.lp,
      };
      if (profile === "bot") {
        captured = cloneBotGameState(unsafeFixture<Parameters<typeof cloneBotGameState>[0]>({
          ...physicalSelf,
          resolveOpponent: () => physicalOpponent,
          strategy,
        }, "Minimal AI fixture exercises the clone input boundary and nested equipment projection"), game);
      } else if (profile === "beamGreedy") {
        await greedySearchWithEvalV2(game, unsafeFixture<Parameters<typeof greedySearchWithEvalV2>[1]>(
          strategy, "Partial fixture player supplies strategy perspective; clone establishes card brands"), { preGeneratedActions: [CLONE_PROBE_ACTION] });
      } else if (profile === "gameTree") {
        gameTreeSearch(game, { ...strategy, bot: { debug: false } }, physicalSelf, 1);
      } else {
        await turnLineSearch(game, strategy, { beamWidth: 1, maxDepth: 1, nodeBudget: 2 });
      }
      const cloned = requireCloneState(captured);
      const clonedCard = required(cloned.bot.hand[0]);
      for (const key of Object.keys(cardState)) {
        assert.deepEqual(Reflect.get(clonedCard, key), Reflect.get(source, key), `card.${key}`);
      }
      for (const key of Object.keys(playerState)) {
        assert.deepEqual(Reflect.get(cloned.bot, key), Reflect.get(physicalSelf, key), `player.${key}`);
      }
      for (const key of ["usedThisTurn", "_simOncePerTurn", "_simPassiveOncePerTurn", "_simUnsupportedActions", "_simGeneratedInstanceCounter", "_simRequiresReplan", "_simUnknownDrawCount"]) {
        assert.deepEqual(Reflect.get(cloned, key), Reflect.get(game, key), `state.${key}`);
      }
      for (const key of ["turnBasedBuffs", "protectionEffects", "oncePerTurnUsageByName", "synchroMaterialRoles"]) {
        assert.notEqual(Reflect.get(clonedCard, key), Reflect.get(source, key), `isolated card.${key}`);
      }
      assert.notEqual(Reflect.get(cloned.bot, "oncePerTurnUsageByName"), Reflect.get(physicalSelf, "oncePerTurnUsageByName"));
      assert.notEqual(cloned._simOncePerTurn, Reflect.get(game, "_simOncePerTurn"));
      assert.equal(Reflect.get(cloned.bot, "id"), actor);
      const projected = unsafeFixture<AiStateShape>(cloned, "Captured clone exposes canonical deferred simulation registrations");
      assert.equal(required(projected.pendingSynchroMaterialFollowups?.[0]).source, clonedCard);
      const delayed = required(projected.delayedActions?.[0]);
      assert.equal(delayed.actionType, "delayed_summon");
      if (delayed.actionType !== "delayed_summon") throw new Error("Expected delayed summon");
      assert.equal(required(delayed.payload.summons[0]).card, clonedCard);
    });
  }
}

test("planning identity preserves synthetic token IDs and future allocation state", () => {
  const game = makeCloneProfileGame();
  const token = required(game.bot.hand[0]);
  Object.assign(token, { instanceId: "sim:token:1", isToken: true });
  Object.assign(game, { _simGeneratedInstanceCounter: 1 });
  const first = fingerprintPlanningState(game);
  Object.assign(token, { instanceId: "sim:token:2" });
  assert.notEqual(fingerprintPlanningState(game), first);
  Object.assign(token, { instanceId: "sim:token:1" });
  assert.equal(fingerprintPlanningState(game), first);
  Object.assign(game, { _simGeneratedInstanceCounter: 2 });
  assert.notEqual(fingerprintPlanningState(game), first);
});

for (const profile of CLONE_PROFILES) {
  for (const actor of ["bot", "player"] as const) {
    test(`${profile} imports canonical runtime usage before planning (${actor})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
      t.after(() => game.dispose("usage_clone_test"));
      game.turnCounter = 7;
      game.turn = actor;
      game.phase = "main1";
      const self = game[actor];
      const opponent = game[actor === "bot" ? "player" : "bot"];
      const source = new Card(cardDefinition(503), actor);
      const second = new Card(cardDefinition(503), actor);
      self.hand.push(source, second);
      source.piercing = true;
      source.effectsNegated = true;
      source.piercingGrantedByEffect = true;
      const shared: EffectDefinition = { id: "shared-test", timing: "ignition", activationZones: ["field"], oncePerTurn: true, usagePolicy: "use", actions: [] };
      const perCard: EffectDefinition = { ...shared, id: "instance-test", oncePerTurnScope: "card", usagePolicy: "activate" };
      game.markOncePerTurnUsed(source, self, shared);
      game.markOncePerTurnUsed(source, self, perCard);
      assert.equal(game.canUseOncePerTurn(source, self, shared).ok, false);
      assert.equal(game.canUseOncePerTurn(second, self, perCard).ok, true);
      assert.equal(self.oncePerTurnUsageByName["shared-test"], undefined, "real usage is held by the canonical Game store");
      let captured: unknown;
      const strategy = {
        bot: self,
        generateMainPhaseActions(state: unknown) {
          if (profile === "gameTree") captured ??= state;
          return [CLONE_PROBE_ACTION];
        },
        simulateMainPhaseAction(state: unknown) { captured ??= state; requireCloneState(state).bot.lp += 1; },
        simulateSpellEffect: () => undefined,
        evaluateBoardV2: (state: unknown) => requireCloneState(state).bot.lp,
        evaluateBoard: (state: unknown) => requireCloneState(state).bot.lp,
      };
      if (profile === "bot") {
        captured = cloneBotGameState(unsafeFixture<Parameters<typeof cloneBotGameState>[0]>(
          { ...self, strategy, resolveOpponent: () => opponent },
          "Concrete Player data with minimal AI strategy for clone regression"), unsafeFixture<Parameters<typeof cloneBotGameState>[1]>(
            game, "Live Game provides canonical ledger; EffectEngine has no legacy usedThisTurn property"));
      } else if (profile === "beamGreedy") {
        await greedySearchWithEvalV2(game, strategy, { preGeneratedActions: [CLONE_PROBE_ACTION] });
      } else if (profile === "gameTree") {
        gameTreeSearch(game, { ...strategy, bot: { debug: false } }, self, 1);
      } else {
        await turnLineSearch(unsafeFixture<Parameters<typeof turnLineSearch>[0]>(
          game, "Live Game has empty temporary battle registrations in this fixture"), strategy, { maxDepth: 1, beamWidth: 1, nodeBudget: 2 });
      }
      const state = unsafeFixture<AiStateShape>(captured, "Captured clone profile establishes simulated state/card brands");
      const card = required(state.bot.hand.find(entry => entry.instanceId === source.instanceId));
      const copy = required(state.bot.hand.find(entry => entry.instanceId === second.instanceId));
      assert.equal(getPiercingDamage(card, 2000, 500), 1500, "external grant remains active when a clone has negated own effects");
      card.piercingGrantedByEffect = false;
      assert.equal(getPiercingDamage(card, 2000, 500), 0);
      assert.equal(source.piercingGrantedByEffect, true, "planning never changes the runtime grant provenance");
      assert.equal(canUseSimulatedEffectUsage(state, shared, card, "bot"), false);
      assert.equal(canUseSimulatedEffectUsage(state, shared, copy, "bot"), false);
      assert.equal(canUseSimulatedEffectUsage(state, perCard, card, "bot"), false);
      assert.equal(canUseSimulatedEffectUsage(state, perCard, copy, "bot"), true);
      state.turnCounter += 1;
      assert.equal(canUseSimulatedEffectUsage(state, shared, card, "bot"), true);
      assert.equal(game.canUseOncePerTurn(source, self, shared).ok, false, "planning did not mutate live ledger");
    });
  }
}
