import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import { getTechZeroVisibleBattlePolicy } from "../../src/core/ai/techzero/priorities.js";
import { evaluateTechZeroVisibleBattle } from "../../src/core/ai/techzero/battle.js";
import { scoreTechZeroLineTerminal } from "../../src/core/ai/techzero/linePlanning.js";
import {
  BOT_BATTLE_BUSY_RETRY_MS,
  BOT_BATTLE_MAX_ATTEMPTS_WITHOUT_PROGRESS,
} from "../../src/core/bot/battleController.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, runtimeCard } from "../helpers/game.js";

function scenario(t: TestContext, actor: "player" | "bot", archetype = "techzero") {
  const first = new Bot(archetype); first.id = "player";
  const second = new Bot(archetype);
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies the Player runtime and clone interface");
  t.after(() => game.dispose("tech_zero_battle_test"));
  game.turn = actor; game.phase = "main1"; game.turnCounter = 2;
  game.disablePresentationDelays = true;
  const bot = actor === "player" ? first : second;
  const opponent = actor === "player" ? second : first;
  const botGame = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Concrete Game satisfies the attached Bot runtime and snapshot boundaries");
  first.game = botGame; second.game = botGame;
  const make = (id: number) => new Card(cardDefinition(id), bot.id);
  const blocker = (def: number) => runtimeCard({ cardKind: "monster", atk: 1000, def,
    position: "defense", isFacedown: false }, opponent.id);
  return { game, botGame, bot, opponent, make, blocker };
}

async function finishBattle(game: ReturnType<typeof scenario>["game"], bot: Bot, botGame: BotGamePort) {
  game.phase = "battle"; botGame.aiBattleDelayMs = 0;
  bot.playBattlePhase(botGame);
  // Bounded by poll count, not by wall clock: 6000 polls of at least 5 ms each
  // wait at least 30 s, so a slow runner does not flake while a hang still fails.
  const battleInProgress = () => !game.gameOver && game.phase === "battle";
  for (let attempt = 0; attempt < 6000 && battleInProgress(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(!battleInProgress(), "Bot must complete the real battle sequence");
}

// Mocked-clock battle driver: bounded by tick count, never by wall clock.
function startMockedBattle(t: TestContext, game: ReturnType<typeof scenario>["game"], bot: Bot, botGame: BotGamePort) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  game.phase = "battle"; botGame.aiBattleDelayMs = 0;
  bot.playBattlePhase(botGame);
}

async function advanceMockedClock(t: TestContext, ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += BOT_BATTLE_BUSY_RETRY_MS) {
    t.mock.timers.tick(BOT_BATTLE_BUSY_RETRY_MS);
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function finishMockedBattle(t: TestContext, game: ReturnType<typeof scenario>["game"]) {
  const battleInProgress = () => !game.gameOver && game.phase === "battle";
  for (let tick = 0; tick < 2000 && battleInProgress(); tick++) {
    await advanceMockedClock(t, BOT_BATTLE_BUSY_RETRY_MS);
  }
  assert.ok(!battleInProgress(), "Bot must leave its Battle Phase");
}

for (const actor of ["player", "bot"] as const) {
  test(`Tech-Zero finds Lancer lethal after spending one attack on a blocker (${actor})`, t => {
    const { bot, opponent, botGame, make, blocker } = scenario(t, actor);
    const lancer = make(516); lancer.attackLimitThisTurn = 3;
    placeFieldCards(bot.field, lancer); placeFieldCards(opponent.field, blocker(2000));
    opponent.lp = 6000;
    assert.equal(getTechZeroVisibleBattlePolicy(botGame, bot).directLethalAvailable, true);
    bot.forbidDirectAttacksThisTurn = true;
    assert.equal(getTechZeroVisibleBattlePolicy(botGame, bot).directLethalAvailable, false,
      "Assembly leaves only the blocker attack despite 9900 raw ATK");
  });

  test(`Tech-Zero recognizes piercing lethal while Assembly forbids direct attacks (${actor})`, t => {
    const { bot, opponent, botGame, make, blocker } = scenario(t, actor);
    placeFieldCards(bot.field, make(517)); placeFieldCards(opponent.field, blocker(2000));
    bot.forbidDirectAttacksThisTurn = true; opponent.lp = 1500;
    assert.equal(getTechZeroVisibleBattlePolicy(botGame, bot).directLethalAvailable, true);
  });

  test(`Tech-Zero does not treat printed ATK as damage through a protected blocker (${actor})`, t => {
    const { bot, opponent, botGame, make, blocker } = scenario(t, actor);
    const lancer = make(516); lancer.attackLimitThisTurn = 3;
    const target = blocker(2000); target.battleIndestructible = true;
    placeFieldCards(bot.field, lancer); placeFieldCards(opponent.field, target);
    opponent.lp = 1000;
    assert.equal(getTechZeroVisibleBattlePolicy(botGame, bot).directLethalAvailable, false);
  });

  test(`Tech-Zero keeps two Lancer attacks over upgrading to higher printed ATK (${actor})`, t => {
    const { bot, botGame, make } = scenario(t, actor);
    const lancer = make(516); lancer.attackLimitThisTurn = 2;
    placeFieldCards(bot.field, lancer);
    const preserving = bot.cloneGameState(botGame), upgrading = bot.cloneGameState(botGame);
    upgrading.bot.field = [];
    const singularity = make(517); placeFieldCards(bot.field, singularity);
    upgrading.bot.field.push(...bot.cloneGameState(botGame).bot.field.filter(card => card.id === 517));
    assert.ok(scoreTechZeroLineTerminal({ finalState: preserving }) >
      scoreTechZeroLineTerminal({ finalState: upgrading }), "6600 realizable damage beats a 4000-ATK upgrade");
  });

  test(`Tech-Zero does not certify lethal through hidden cards or battle triggers (${actor})`, t => {
    const { bot, opponent, make, blocker } = scenario(t, actor);
    const lancer = make(516); lancer.attackLimitThisTurn = 3;
    const target = blocker(0); target.isFacedown = true;
    placeFieldCards(bot.field, lancer); placeFieldCards(opponent.field, target); opponent.lp = 5000;
    const first = evaluateTechZeroVisibleBattle(bot, opponent, 2);
    Object.assign(target, { atk: 9000, def: 9000, name: "Unknown replacement", battleIndestructible: true,
      preventsBattleDamageToController: true });
    assert.deepEqual(evaluateTechZeroVisibleBattle(bot, opponent, 2), first);
    assert.equal(first.lethal, false); assert.equal(first.complete, false);
    assert.ok(first.uncertainties.includes("hidden_cards"));
    opponent.field = [make(514)]; opponent.field[0]!.owner = opponent.id;
    assert.equal(evaluateTechZeroVisibleBattle(bot, opponent, 2).lethal, false,
      "Phoenix's damage recovery is not simulated as an ordinary dead blocker");
  });

  test(`Tech-Zero executes piercing before Lancer's direct attacks for lethal (${actor})`, async t => {
    const { game, bot, opponent, botGame, make, blocker } = scenario(t, actor);
    const lancer = make(516), singularity = make(517), target = blocker(2000);
    lancer.attackLimitThisTurn = 2;
    placeFieldCards(bot.field, lancer, singularity); placeFieldCards(opponent.field, target);
    const attacks: Array<[number | null | undefined, number | string | null]> = [];
    game.on("attack_declared", ({ attacker, target: attacked }) => { attacks.push([attacker.id, attacked?.instanceId ?? null]); });
    const projected = evaluateTechZeroVisibleBattle(bot, opponent, 2);
    assert.equal(projected.lethal, true);
    assert.equal(required(projected.attacks[0]).attackerInstanceId, singularity.instanceId);
    await finishBattle(game, bot, botGame);
    assert.deepEqual(attacks, [[517, target.instanceId], [516, null], [516, null]]);
    assert.equal(opponent.lp, 0);
    assert.equal(projected.damage, 8000, "projected damage matches actual LP lost, excluding overkill");
    assert.equal(lancer.attacksUsedThisTurn, 2);
  });

  test(`Tech-Zero executes only piercing damage when Assembly blocks the apparent lethal (${actor})`, async t => {
    const { game, bot, opponent, botGame, make, blocker } = scenario(t, actor);
    const lancer = make(516), singularity = make(517), target = blocker(2000);
    lancer.attackLimitThisTurn = 2; bot.forbidDirectAttacksThisTurn = true;
    placeFieldCards(bot.field, lancer, singularity); placeFieldCards(opponent.field, target);
    const attacks: Array<[number | null | undefined, number | string | null]> = [];
    game.on("attack_declared", ({ attacker, target: attacked }) => { attacks.push([attacker.id, attacked?.instanceId ?? null]); });
    assert.equal(evaluateTechZeroVisibleBattle(bot, opponent, 2).lethal, false);
    await finishBattle(game, bot, botGame);
    assert.deepEqual(attacks, [[517, target.instanceId]]);
    assert.equal(opponent.lp, 6000);
    assert.equal(game.gameOver, false);
  });

  test(`Tech-Zero retains a zero-ATK blocker after a zero-ATK tie (${actor})`, t => {
    const { bot, opponent, blocker } = scenario(t, actor);
    const attacker = runtimeCard({ cardKind: "monster", atk: 0, def: 0, position: "attack" }, bot.id);
    const target = blocker(0); target.atk = 0; target.position = "attack";
    placeFieldCards(bot.field, attacker); placeFieldCards(opponent.field, target);
    const projected = evaluateTechZeroVisibleBattle(bot, opponent, 2, {
      attackerInstanceId: attacker.instanceId, targetInstanceId: target.instanceId,
    });
    assert.equal(projected.destroyed, 0); assert.equal(projected.lost, 0);
  });

  test(`Tech-Zero renews protection used on a previous turn and consumes it sequentially (${actor})`, t => {
    const { bot, opponent, make, blocker } = scenario(t, actor);
    const lancer = make(516), target = blocker(2000);
    lancer.attackLimitThisTurn = 2; target.battleIndestructibleOncePerTurn = true;
    target.battleIndestructibleOncePerTurnUsed = true; target.battleIndestructibleOncePerTurnLastUsedTurn = 1;
    placeFieldCards(bot.field, lancer); placeFieldCards(opponent.field, target); opponent.lp = 1000;
    const first = evaluateTechZeroVisibleBattle(bot, opponent, 2);
    assert.equal(first.damage, 0); assert.equal(first.lethal, false);
    assert.equal(target.battleIndestructibleOncePerTurnLastUsedTurn, 1, "projection preserves live protection state");
    lancer.attackLimitThisTurn = 3;
    assert.equal(evaluateTechZeroVisibleBattle(bot, opponent, 2).lethal, true);
    assert.equal(lancer.attacksUsedThisTurn, 0, "projection preserves live attack usage");
  });

  test(`Tech-Zero uses runtime attack-all target visibility and monster-only restrictions (${actor})`, t => {
    const { game, bot, opponent, make, blocker } = scenario(t, actor);
    const lancer = make(516), target = blocker(1000);
    placeFieldCards(bot.field, lancer); placeFieldCards(opponent.field, target);
    lancer.canAttackAllOpponentMonstersThisTurn = true; target.isFacedown = true;
    assert.equal(game.getAttackAvailability(lancer).ok, false);
    assert.deepEqual(evaluateTechZeroVisibleBattle(bot, opponent, 2).attacks, []);
    lancer.canAttackAllOpponentMonstersThisTurn = false; target.isFacedown = false;
    lancer.attackLimitThisTurn = 3; lancer.extraAttackTargetRestriction = "monster";
    assert.equal(evaluateTechZeroVisibleBattle(bot, opponent, 2).damage, 0);
  });

  test(`Tech-Zero does not certify damage before an opposing Ghost's Damage Step effect (${actor})`, t => {
    const { bot, opponent, make } = scenario(t, actor);
    const lancer = make(516), ghost = make(511);
    lancer.atk = 2500; lancer.lastSummonMethod = "synchro";
    ghost.owner = opponent.id; ghost.atk = 2000;
    placeFieldCards(bot.field, lancer); placeFieldCards(opponent.field, ghost); opponent.lp = 100;
    const projection = evaluateTechZeroVisibleBattle(bot, opponent, 2);
    assert.equal(projection.lethal, false);
    assert.ok(projection.uncertainties.includes("battle_triggers"));
  });

  test(`Bot battle loop stops after Arctroth Pursuer's two granted attacks (${actor})`, async t => {
    const { game, bot, opponent, botGame, make } = scenario(t, actor, "shadowheart");
    const pursuer = make(123), first = runtimeCard({ cardKind: "monster", atk: 1000, def: 1000,
      position: "attack", isFacedown: false }, opponent.id);
    const revived = runtimeCard({ cardKind: "monster", atk: 500, def: 500, level: 1, isFacedown: false }, opponent.id);
    placeFieldCards(bot.field, pursuer); placeFieldCards(opponent.field, first);
    opponent.graveyard.push(revived); opponent.lp = 8000;
    const attacks: Array<number | string | null> = [];
    game.on("attack_declared", ({ target: attacked }) => { attacks.push(attacked?.instanceId ?? null); });
    startMockedBattle(t, game, bot, botGame);
    await finishMockedBattle(t, game);
    assert.deepEqual(attacks, [first.instanceId, revived.instanceId]);
    assert.equal(pursuer.attacksUsedThisTurn, 2);
  });

  test(`Bot battle loop waits on a busy guard without spending attempts (${actor})`, async t => {
    const { game, bot, opponent, botGame } = scenario(t, actor);
    const attacker = runtimeCard({ cardKind: "monster", atk: 1500, def: 0, position: "attack" }, bot.id);
    placeFieldCards(bot.field, attacker); opponent.lp = 8000;
    let busy = true, busyChecks = 0;
    const canStartAction = game.canStartAction.bind(game);
    t.mock.method(game, "canStartAction", (options?: Parameters<typeof canStartAction>[0]) => {
      if (!busy || options?.silent !== true) return canStartAction(options);
      busyChecks++;
      return { ok: false as const, success: false as const, needsSelection: false as const,
        code: "BLOCKED_RESOLVING", reason: "busy fixture" };
    });
    const resolveCombat = t.mock.method(game, "resolveCombat");
    startMockedBattle(t, game, bot, botGame);
    await advanceMockedClock(t, 200);
    assert.equal(resolveCombat.mock.callCount(), 0, "no attack command while the duel is busy");
    assert.equal(game.phase, "battle");
    assert.ok(busyChecks >= 200 / BOT_BATTLE_BUSY_RETRY_MS);
    busy = false;
    await finishMockedBattle(t, game);
    assert.equal(resolveCombat.mock.callCount(), 1);
    assert.equal(opponent.lp, 6500);
    assert.equal(game.phase, "main2");
  });

  test(`Bot battle loop ends the phase when resolveCombat changes nothing (${actor})`, async t => {
    const { game, bot, opponent, botGame, blocker } = scenario(t, actor);
    const attackers = [3000, 2900].map(atk =>
      runtimeCard({ cardKind: "monster", atk, def: 0, position: "attack" }, bot.id));
    placeFieldCards(bot.field, ...attackers); placeFieldCards(opponent.field, blocker(1000), blocker(1000));
    const pairs: string[] = [];
    t.mock.method(game, "resolveCombat", async (attacker: { instanceId: number } | null, target: { instanceId: number } | null) => {
      pairs.push(`${attacker?.instanceId}>${target?.instanceId ?? "direct"}`);
      return { ok: true };
    });
    startMockedBattle(t, game, bot, botGame);
    await finishMockedBattle(t, game);
    assert.equal(pairs.length, BOT_BATTLE_MAX_ATTEMPTS_WITHOUT_PROGRESS);
    assert.equal(new Set(pairs).size, pairs.length, "a rejected pair is not retried");
    assert.equal(game.phase, "main2");
  });
}
