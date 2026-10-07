import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import AutoSelector from "../../src/core/AutoSelector.js";
import type Card from "../../src/core/Card.js";
import type { SelectionIntent, SelectionStrategy } from "../../src/core/contracts/selection.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, runtimeCard } from "../helpers/game.js";

type Context = Parameters<AutoSelector["getCandidateScore"]>[2];
type Candidate = NonNullable<Parameters<AutoSelector["getCandidateScore"]>[0]>;
type Preference = NonNullable<NonNullable<NonNullable<Context["activationContext"]>["actionContext"]>["targetPreference"]>;

function scenario(t: TestContext, seat: "player" | "bot") {
  const game = createRuntimeGame({ randomSeed: 42 });
  t.after(() => game.dispose("auto_selector_visibility"));
  const actor = game[seat];
  const opponent = game[seat === "player" ? "bot" : "player"];
  actor.controllerType = "ai";
  const selector = new AutoSelector({
    player: game.player,
    bot: game.bot,
    getOpponent: player => player.id === game.player.id ? game.bot
      : player.id === game.bot.id ? game.player : null,
  });
  const context: Context = { player: actor };
  const hidden = (name: string, atk: number, level: number, owner = opponent.id) => runtimeCard({
    name, cardKind: "monster", atk, def: atk, level, position: "defense", isFacedown: true,
  }, owner);
  const candidate = (card: Card, key: string, zone: "field" | "spellTrap" = "field"): Candidate => ({
    key, controller: card.owner, zone, cardRef: card, atk: card.atk, def: card.def,
  });
  return { game, actor, opponent, selector, context, hidden, candidate };
}

function withPreference(context: Context, preference: Preference): Context {
  return { ...context, activationContext: { actionContext: { targetPreference: preference } } };
}

for (const seat of ["player", "bot"] as const) {
  test(`Tera keeps the same target and RNG when only opposing hidden levels change (${seat})`, t => {
    const { game, actor, opponent, hidden } = scenario(t, seat);
    const source = runtimeCard(cardDefinition(306), actor.id);
    const left = hidden("Hidden left", 1000, 1);
    const right = hidden("Hidden right", 1000, 4);
    placeFieldCards(actor.field, source);
    placeFieldCards(opponent.field, left, right);
    const effect = required(source.effects.find(entry => entry.id === "tera_arcanist_earth_ignition"));
    const publicView = () => opponent.field.map(card => ({ instanceId: card.instanceId, fieldSlot: card.fieldSlot,
      position: card.position, isFacedown: card.isFacedown }));
    const originalPublicView = publicView();
    const originalRandom = game.getRandomState();
    const select = () => {
      game.effectEngine.clearTargetingCache();
      const result = game.effectEngine.resolveTargets(required(effect.targets), {
        source, player: actor, opponent, activationContext: { autoSelectTargets: true },
      }, null);
      assert.ok(result.ok && "targets" in result);
      return result.targets.tera_arcanist_earth_targets;
    };
    assert.deepEqual(select(), [left]);
    left.level = 4;
    right.level = 1;
    assert.deepEqual(select(), [left]);
    assert.deepEqual(publicView(), originalPublicView);
    assert.deepEqual(game.getRandomState(), originalRandom);
  });

  test(`all explicit stat rankings tie opposing hidden monsters in original order (${seat})`, t => {
    const { selector, context, hidden, candidate } = scenario(t, seat);
    const left = candidate(hidden("Left", 100, 1), "left");
    const right = candidate(hidden("Right", 4000, 12), "right");
    const strategies: SelectionStrategy[] = ["highest_atk", "lowest_atk", "highest_def", "lowest_def"];
    for (const strategy of strategies) {
      for (const candidates of [[left, right], [right, left]]) {
        assert.deepEqual(selector.orderCandidates({ strategy }, candidates, context), candidates, strategy);
      }
    }
    assert.equal(left.atk, 100);
    assert.equal(right.cardRef?.atk, 4000);
  });

  test(`all scoring preferences ignore opposing hidden identities, abilities and stats (${seat})`, t => {
    const { selector, context, hidden, candidate, actor } = scenario(t, seat);
    const left = hidden("Ordinary", 100, 1);
    const right = hidden("Preferred", 4000, 12);
    Object.assign(right, { id: 987, archetype: "Extreme Dragons", archetypes: ["Extreme Dragons"],
      goodDiscard: true, cannotBeNormalSummonedOrSet: true, usedEffectThisTurn: true, hasAttacked: true,
      mustBeAttacked: true, piercing: true, extraAttacks: 3, battleIndestructibleOncePerTurn: true,
      cannotAttackThisTurn: true, tempAtkBoost: 300, equipAtkBonus: 100, tempDefBoost: 400,
      effects: [{ id: "hidden_draw", timing: "ignition", activationZones: ["field"],
        actions: [{ type: "draw", amount: 5, player: "self" }] }],
    });
    const candidates = [candidate(left, "left"), candidate(right, "right")];
    const attacker = runtimeCard({ name: "Attacker", cardKind: "monster", atk: 1800, position: "attack" }, actor.id);
    const cases: Array<[SelectionIntent, Preference]> = [
      ["harm", {}], ["benefit", {}], ["cost", {}], ["declare", {}],
      ["harm", { role: "removal", preferredNames: ["Preferred"], avoidNames: ["Ordinary"] }],
      ["benefit", { role: "named_preference", preferredNames: ["Preferred"] }],
      ["benefit", { role: "recursion", purpose: "offense", offensiveNames: ["Preferred"] }],
      ["benefit", { role: "recursion", purpose: "defense", defensiveNames: ["Preferred"] }],
      ["benefit", { role: "stance_dance_buff", sourceCardId: 987, preferredName: "Preferred", atkBoost: 500 }],
      ["benefit", { role: "temporary_stat_buff", purpose: "offense", atkBoost: 500 }],
      ["harm", { role: "temporary_stat_debuff", purpose: "combat", attackers: [attacker], atkReduction: 1500 }],
      ["cost", { archetype: "Extreme Dragons", forceNames: ["Preferred"], preferNames: ["Preferred"],
        preserveNames: ["Ordinary"], avoidNames: ["Ordinary"], preserveLastOffensivePayoff: true,
        offensivePayoffNames: ["Preferred"], stableDefense: true }],
    ];
    for (const [intent, preference] of cases) {
      const scoringContext = withPreference(context, preference);
      assert.equal(selector.getCandidateScore(candidates[0], intent, scoringContext),
        selector.getCandidateScore(candidates[1], intent, scoringContext), JSON.stringify([intent, preference]));
      assert.deepEqual(selector.orderCandidates({ intent }, candidates, scoringContext), candidates);
    }
    assert.equal(right.name, "Preferred");
    assert.equal(right.level, 12);
    assert.equal(right.piercing, true);
  });

  test(`hidden backrow has generic value even when its underlying kind and effects differ (${seat})`, t => {
    const { selector, context, opponent, candidate } = scenario(t, seat);
    const spell = runtimeCard({ name: "Polymerization", cardKind: "spell", isFacedown: true,
      effects: [{ id: "hidden_backrow_draw", timing: "on_activate",
        actions: [{ type: "draw", amount: 3, player: "self" }] }] }, opponent.id);
    const trap = runtimeCard({ name: "Secret Covenant", cardKind: "trap", isFacedown: true }, opponent.id);
    const monster = runtimeCard({ name: "Hidden equipped monster", cardKind: "monster", atk: 4000,
      def: 4000, level: 12, isFacedown: true }, opponent.id);
    for (const card of [spell, trap, monster]) {
      const entry = candidate(card, "backrow", "spellTrap");
      assert.equal(selector.getCandidateScore(entry, "declare", context), 0.25);
      assert.equal(selector.getCandidateScore(entry, "cost", context), 0.25);
      assert.equal(selector.getCandidateScore(entry, "benefit", withPreference(context, { role: "recursion" })), -100.4);
    }
  });

  test(`own facedowns and opposing face-up cards retain values and identity preferences (${seat})`, t => {
    const { selector, context, actor, hidden, candidate } = scenario(t, seat);
    const own = hidden("Preferred", 2000, 5, actor.id);
    const faceUp = hidden("Preferred", 2000, 5);
    faceUp.isFacedown = false;
    faceUp.position = "attack";
    assert.ok(Math.abs(selector.getCandidateScore(candidate(own, "own"), "benefit", context) - 1.87) < 1e-9);
    assert.equal(selector.getCandidateScore(candidate(faceUp, "public"), "harm", context), 3.2);
    const preference = withPreference(context, { role: "named_preference", preferredNames: ["Preferred"] });
    assert.ok(selector.getCandidateScore(candidate(own, "own"), "benefit", preference) > 40);
    assert.ok(selector.getCandidateScore(candidate(faceUp, "public"), "harm", preference) > 40);
    const higher = hidden("Higher", 3000, 1, actor.id);
    assert.deepEqual(selector.orderCandidates({ strategy: "highest_atk" },
      [candidate(own, "own"), candidate(higher, "higher")], context).map(entry => entry.key), ["higher", "own"]);
  });

  test(`visibility follows owner actor precedence and physical controller IDs (${seat})`, t => {
    const { selector, context, actor, opponent, hidden, candidate } = scenario(t, seat);
    const card = hidden("Controlled card", 4000, 12, actor.id);
    const entry = { ...candidate(card, "controlled"), controller: opponent.id, owner: "player" };
    const actorContext = { owner: { ...actor }, player: opponent };
    assert.ok(Math.abs(selector.getCandidateScore(entry, "declare", actorContext) - 1.05) < 1e-9);
    const ownContext = { owner: { ...opponent }, player: actor };
    assert.ok(selector.getCandidateScore(entry, "declare", ownContext) > 2);
    const unowned: Candidate = { key: "unknown", cardRef: { name: "Unproven", cardKind: "monster",
      atk: 4000, def: 4000, level: 12, position: "defense", isFacedown: true } };
    assert.ok(Math.abs(selector.getCandidateScore(unowned, "declare", context) - 1.05) < 1e-9);
    assert.ok(Math.abs(selector.getCandidateScore(candidate(card, "without-actor"), "declare", {}) - 1.05) < 1e-9);
  });

  test(`flat candidate data cannot bypass hidden scoring (${seat})`, t => {
    const { selector, context, opponent } = scenario(t, seat);
    const entry = { key: "flat", controller: opponent.id, zone: "field" as const, cardKind: "monster",
      name: "Secret", atk: 5000, def: 5000, level: 12, position: "defense", isFacedown: true };
    assert.ok(Math.abs(selector.getCandidateScore(entry, "declare", context) - 1.05) < 1e-9);
  });

  test(`cost payoff preservation never reads the opponent hand or deck (${seat})`, t => {
    const { selector, context, opponent, actor, candidate } = scenario(t, seat);
    const payoff = runtimeCard({ name: "Payoff", cardKind: "monster", atk: 2800, def: 2000,
      level: 8, position: "attack" }, opponent.id);
    const preferences: Preference = { preserveLastOffensivePayoff: true, offensivePayoffNames: ["Payoff"] };
    const scoringContext = withPreference(context, preferences);
    const before = selector.getCandidateScore(candidate(payoff, "payoff"), "cost", scoringContext);
    const originalHand = opponent.hand;
    const originalDeck = opponent.deck;
    Object.defineProperties(opponent, {
      hand: { configurable: true, get: () => { throw new Error("opponent hand was read"); } },
      deck: { configurable: true, get: () => { throw new Error("opponent deck was read"); } },
    });
    try {
      assert.equal(selector.getCandidateScore(candidate(payoff, "payoff"), "cost", scoringContext), before);
    } finally {
      Object.defineProperties(opponent, {
        hand: { configurable: true, writable: true, value: originalHand },
        deck: { configurable: true, writable: true, value: originalDeck },
      });
    }
    payoff.owner = actor.id;
    actor.hand.push(payoff);
    const one = selector.getCandidateScore(candidate(payoff, "own"), "cost", scoringContext);
    actor.deck.push(runtimeCard({ name: "Payoff", cardKind: "monster" }, actor.id));
    assert.equal(one - selector.getCandidateScore(candidate(payoff, "own"), "cost", scoringContext), 80);
  });

  test(`combat preferences never inspect opposing hidden card abilities (${seat})`, t => {
    const { selector, context, actor, opponent, hidden, candidate } = scenario(t, seat);
    const attacker = runtimeCard({ name: "Own attacker", cardKind: "monster", atk: 1300, level: 4,
      position: "attack" }, actor.id);
    const secret = hidden("Secret", 4000, 12);
    placeFieldCards(opponent.field, secret);
    const snapshot = { name: secret.name, atk: secret.atk, def: secret.def, level: secret.level, effects: secret.effects };
    for (const key of ["name", "atk", "def", "level", "effects"] as const) {
      Object.defineProperty(secret, key, { configurable: true, get: () => { throw new Error(`hidden ${key} was read`); } });
    }
    try {
      assert.equal(selector.getCandidateScore(candidate(attacker, "attacker"), "benefit", withPreference(context,
        { role: "temporary_stat_buff", purpose: "offense", atkBoost: 500 })), 95.2);
      const target = runtimeCard({ name: "Public defender", cardKind: "monster", atk: 2000, def: 2000,
        position: "attack" }, opponent.id);
      assert.equal(selector.getCandidateScore(candidate(target, "target"), "harm", withPreference(context,
        { role: "temporary_stat_debuff", purpose: "combat", attackers: [secret], atkReduction: 1000 })), 0.4);
    } finally {
      for (const key of ["name", "atk", "def", "level", "effects"] as const) {
        Object.defineProperty(secret, key, { configurable: true, writable: true, value: snapshot[key] });
      }
    }
  });

  test(`exact instance decisions remain authoritative for hidden targets (${seat})`, t => {
    const { selector, context, hidden, candidate } = scenario(t, seat);
    const left = hidden("Left", 1000, 1), right = hidden("Right", 4000, 12);
    const contract = { requirements: [{ id: "target", min: 1, max: 1, intent: "harm" as const,
      candidates: [candidate(left, "left"), candidate(right, "right")] }] };
    assert.deepEqual(selector.select(contract, { ...context, activationContext: {
      decisions: { selections: { target: [right.instanceId] } },
    } }), { ok: true, selections: { target: ["right"] } });
    assert.deepEqual(selector.select(contract, context), { ok: true, selections: { target: ["left"] } });
  });
}
