import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import Card from "../../src/core/Card.js";
import TechZeroStrategy from "../../src/core/ai/TechZeroStrategy.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { BotCloneGamePort } from "../../src/core/bot/simulationBridge.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

function scenario(t: TestContext, seat: "player" | "bot" = "bot") {
  const first = new Bot("techzero");
  first.id = "player";
  const second = new Bot("techzero");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: false, laboratoryMode: true });
  game.player = unsafeFixture<typeof game.player>(first, "Real Bot supplies the Player runtime methods");
  const port = unsafeFixture<BotGamePort & BotCloneGamePort & AiLiveGamePort>(game,
    "Real Game satisfies the attached bot methods and snapshot boundary");
  first.game = port;
  second.game = port;
  game.turn = seat;
  game.turnCounter = 2;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  const bot = seat === "player" ? first : second;
  const opponent = seat === "player" ? second : first;
  assert.ok(bot.strategy instanceof TechZeroStrategy);
  const strategy = bot.strategy;
  const make = (id: number) => new Card(cardDefinition(id), seat);
  t.after(() => game.dispose("tech_zero_policy_integration"));
  return { game, bot, opponent, strategy, port, make };
}

for (const seat of ["player", "bot"] as const) {
  test(`Connector permits the additional Normal only while active in runtime and clone (${seat})`, t => {
    const { bot, strategy, port, make } = scenario(t, seat);
    const connector = make(507), catapult = make(502);
    placeFieldCards(bot.field, connector);
    bot.hand.push(catapult);
    bot.summonCount = 1;
    const canGenerate = () => {
      const clone = bot.cloneGameState(port);
      const localStrategy = new TechZeroStrategy(clone.bot);
      return [strategy.generateMainPhaseActions(port), localStrategy.generateMainPhaseActions(clone)]
        .map(actions => actions.some(action => action.type === "summon" && action.cardId === 502));
    };
    assert.deepEqual(canGenerate(), [true, true]);
    connector.effectsNegated = true;
    assert.deepEqual(canGenerate(), [false, false]);
    connector.effectsNegated = false;
    bot.summonCount = 2;
    assert.deepEqual(canGenerate(), [false, false]);
  });

  test(`Kaiser and Ghost decline the exact tuner reserved for Scrapyard (${seat})`, t => {
    const { bot, strategy, port, make } = scenario(t, seat);
    const multimodal = make(503), kaiser = make(513), ghost = make(511);
    multimodal.properSummonEstablished = true;
    placeFieldCards(bot.field, make(514));
    bot.graveyard.push(multimodal);
    bot.extraDeck.push(make(516));
    bot.spellTrap.push(make(520));
    for (const source of [kaiser, ghost]) {
      const effect = required(source.effects[0]);
      assert.equal(strategy.shouldActivateEffect({ sourceCard: source, effect, player: bot, game: port }), false);
      const plan = required(strategy.buildActivationContextForEffect({ sourceCard: source, effect, player: bot, game: port }));
      assert.deepEqual(Object.values(plan.decisions?.selections || {}), [[]]);
    }
    const spare = make(504);
    bot.graveyard.push(spare);
    assert.equal(strategy.shouldActivateEffect({ sourceCard: kaiser, effect: required(kaiser.effects[0]), player: bot, game: port }), true);
    const plan = required(strategy.buildActivationContextForEffect({ sourceCard: kaiser, effect: required(kaiser.effects[0]), player: bot, game: port }));
    assert.deepEqual(plan.decisions?.selections?.tech_zero_turbocharge_kaiser_recycle_targets, [spare.instanceId]);
  });
}

test("Assembly's direct lethal check excludes monster-only extra attacks", t => {
  const { bot, opponent, strategy, port, make } = scenario(t);
  const lancer = make(516);
  lancer.attackLimitThisTurn = 2;
  placeFieldCards(bot.field, lancer);
  opponent.lp = 5000;
  assert.equal(strategy.policyContext(port).directLethalAvailable, true);
  lancer.extraAttackTargetRestriction = "monster";
  assert.equal(strategy.policyContext(port).directLethalAvailable, false);
  opponent.lp = 3000;
  assert.equal(strategy.policyContext(port).directLethalAvailable, true);
  lancer.attacksUsedThisTurn = 1;
  assert.equal(strategy.policyContext(port).directLethalAvailable, false);
});

test("Assembly's direct lethal check excludes attack-all mode and an opponent turn", t => {
  const { game, bot, opponent, strategy, port, make } = scenario(t);
  const lancer = make(516);
  placeFieldCards(bot.field, lancer);
  opponent.lp = 1000;
  lancer.canAttackAllOpponentMonstersThisTurn = true;
  assert.equal(strategy.policyContext(port).directLethalAvailable, false);
  lancer.canAttackAllOpponentMonstersThisTurn = false;
  game.turn = opponent.id;
  assert.equal(strategy.policyContext(port).directLethalAvailable, false);
});

test("Assembly does not spend protected resources against a hit stopped by a defense body", t => {
  const { bot, opponent, strategy, port, make } = scenario(t);
  bot.lp = 500;
  placeFieldCards(opponent.field, new Card(cardDefinition(516), opponent.id));
  assert.equal(strategy.policyContext(port).threatenedLethal, true);
  const wall = make(514);
  wall.position = "defense";
  placeFieldCards(bot.field, wall);
  assert.equal(strategy.policyContext(port).threatenedLethal, false);
  wall.position = "attack";
  assert.equal(strategy.policyContext(port).threatenedLethal, true, "a 700 damage hit is now lethal");
  wall.preventsBattleDamageToController = true;
  assert.equal(strategy.policyContext(port).threatenedLethal, false);
});

test("Assembly threat assessment ignores hidden opponent stats and active direct-attack locks", t => {
  const { bot, opponent, strategy, port } = scenario(t);
  bot.lp = 500;
  const threat = new Card(cardDefinition(516), opponent.id);
  placeFieldCards(opponent.field, threat);
  threat.isFacedown = true;
  assert.equal(strategy.policyContext(port).threatenedLethal, false);
  threat.isFacedown = false;
  opponent.forbidDirectAttacksThisTurn = true;
  assert.equal(strategy.policyContext(port).threatenedLethal, false);
});

test("Special and Normal summons use the same defense preference under a visible threat", async t => {
  const { game, bot, opponent, strategy, port, make } = scenario(t);
  const core = make(501);
  bot.hand.push(core);
  placeFieldCards(opponent.field, new Card(cardDefinition(516), opponent.id));
  const action = required(strategy.generateMainPhaseActions(port).find(entry => entry.type === "summon"));
  assert.equal(action.type, "summon");
  if (action.type !== "summon") return;
  assert.equal(action.position, "defense");
  const positionPlayer = unsafeFixture<Parameters<typeof game.effectEngine.chooseSpecialSummonPosition>[1]>(bot,
    "Real Bot carries the concrete TechZeroStrategy position hook; the narrower effect port omits unrelated Game methods");
  assert.equal(await game.effectEngine.chooseSpecialSummonPosition(core, positionPlayer), "defense");
  const clone = bot.cloneGameState(port);
  const projected = new TechZeroStrategy(clone.bot);
  assert.equal(projected.chooseSpecialSummonPosition(required(clone.bot.hand[0]), { game: clone, player: clone.bot }), "defense");
});

test("Synchro ordering favors Portal's real recovery over a weak immediate body", t => {
  const { bot, strategy, port, make } = scenario(t);
  const core = make(501), machine = make(503), wyvern = make(504);
  machine.level = 1;
  placeFieldCards(bot.field, core, machine, wyvern);
  bot.extraDeck.push(make(509), make(511));
  const portal = required(bot.extraDeck.find(card => card.id === 509));
  bot.graveyard.push(make(503), make(502), make(506));
  const richScore = required(strategy.generateMainPhaseActions(port).find(action => action.type === "synchro" && action.synchroInstanceId === portal.instanceId && action.position === "attack")).priority;
  bot.graveyard.length = 0;
  const poorScore = required(strategy.generateMainPhaseActions(port).find(action => action.type === "synchro" && action.synchroInstanceId === portal.instanceId && action.position === "attack")).priority;
  assert.ok(required(richScore) > required(poorScore), "the same material conversion values its actual recovery targets");
});
