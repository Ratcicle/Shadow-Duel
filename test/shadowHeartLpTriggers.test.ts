import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";
import { cardDefinition, required } from "./helpers/fixtures.js";

function setup(seat: "player" | "bot" = "player") {
  const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
  game.turn = "player";
  game.turnCounter = 5;
  game.phase = "main1";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.player.controllerType = game.bot.controllerType = "ai";
  game.ui.showConfirmPrompt = async () => true;
  game.ui.showChainResponseModal = async () => null;
  const owner = game[seat];
  const opponent = seat === "player" ? game.bot : game.player;
  const mage = new Card(cardDefinition(118), owner.id);
  const cathedral = new Card(cardDefinition(119), owner.id);
  placeFieldCards(owner.field, mage);
  placeFieldCards(owner.spellTrap, cathedral);
  owner.deck.push(...Array.from({ length: 4 }, () => new Card(cardDefinition(101), owner.id)));
  return { game, owner, opponent, mage, cathedral };
}

for (const seat of ["player", "bot"] as const) {
  for (const state of ["active", "negated", "facedown"] as const) {
    test(`LP triggers ${state}, ${seat}: damage resolves through Chain exactly once`, async (t) => {
      const { game, owner, opponent, mage, cathedral } = setup(seat);
      t.after(() => game.dispose());
      mage.isFacedown = cathedral.isFacedown = state === "facedown";
      mage.effectsNegated = cathedral.effectsNegated = state === "negated";
      let changes = 0;
      let links = 0;
      game.on("lp_change", () => { changes++; });
      game.on("chain_link_resolution", (payload) => { if (payload.stage === "completed") links++; });
      await game.inflictDamage(opponent, 1500, { sourceCard: mage });
      assert.equal(owner.hand.length, state === "active" ? 1 : 0);
      assert.equal(cathedral.getCounter("judgment_marker"), state === "active" ? 1 : 0);
      assert.equal(changes, 1);
      if (state === "active") assert.equal(links, 2);
    });
  }
}

for (const amount of [499, 500, 1500]) {
  test(`Cathedral threshold: ${amount} damage`, async (t) => {
    const { game, opponent, cathedral } = setup();
    t.after(() => game.dispose());
    await game.effectEngine.applyDamage({ type: "damage", player: "opponent", amount }, {
      player: game.player, opponent, source: cathedral,
    });
    assert.equal(cathedral.getCounter("judgment_marker"), amount < 500 ? 0 : 1);
  });
}

test("opponent cost loss draws, but does not add a damage counter", async (t) => {
  const { game, owner, opponent, mage, cathedral } = setup();
  t.after(() => game.dispose());
  await game.effectEngine.applyActions([{ type: "pay_lp", amount: 500 }], {
    player: opponent, opponent: owner, source: mage,
  }, {});
  assert.equal(opponent.lp, 7500);
  assert.equal(owner.hand.length, 1);
  assert.equal(cathedral.getCounter("judgment_marker"), 0);
});

test("gain and zero change do not trigger loss effects", async (t) => {
  const { game, owner, opponent, mage, cathedral } = setup();
  t.after(() => game.dispose());
  let changes = 0;
  game.on("lp_change", () => { changes++; });
  await game.inflictDamage(opponent, 0);
  await game.effectEngine.applyActions([{ type: "pay_lp", amount: 0 }], {
    player: opponent, opponent: owner, source: mage,
  }, {});
  assert.equal(changes, 0);
  await game.effectEngine.applyHeal({ type: "heal", player: "opponent", amount: 500 }, {
    player: owner, opponent, source: mage,
  });
  assert.equal(changes, 1);
  assert.equal(owner.hand.length, 0);
  assert.equal(cathedral.getCounter("judgment_marker"), 0);
});

test("damage amount is actual LP loss, not the requested damage", async (t) => {
  const { game, opponent, cathedral } = setup();
  t.after(() => game.dispose());
  opponent.lp = 499;
  let lost: number | undefined;
  game.on("lp_change", (payload) => { lost = payload.lpLost; });
  await game.inflictDamage(opponent, 1500);
  assert.equal(lost, 499);
  assert.equal(cathedral.getCounter("judgment_marker"), 0);
});

test("battle damage produces one canonical occurrence and one trigger per source", async (t) => {
  const { game, owner, opponent, mage, cathedral } = setup();
  t.after(() => game.dispose());
  game.phase = "battle";
  game.battleStep = "battle";
  const attacker = new Card({ name: "LP attacker", cardKind: "monster", atk: 1600, def: 0 }, owner.id);
  const defender = new Card({ name: "LP defender", cardKind: "monster", atk: 1000, def: 0 }, opponent.id);
  placeFieldCards(owner.field, attacker);
  placeFieldCards(opponent.field, defender);
  let changes = 0;
  game.on("lp_change", () => { changes++; });
  await game.resolveCombat(attacker, defender);
  assert.equal(opponent.lp, 7400);
  assert.equal(owner.hand.length, 1);
  assert.equal(cathedral.getCounter("judgment_marker"), 1);
  assert.equal(changes, 1);
  assert.ok(owner.field.includes(mage));
});

test("negation added in response stops both LP trigger resolutions", async (t) => {
  const { game, owner, opponent, mage, cathedral } = setup();
  t.after(() => game.dispose());
  let responses = 0;
  game.chainSystem.offerChainResponses = async () => {
    responses++;
    mage.effectsNegated = cathedral.effectsNegated = true;
    return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
  };
  await game.inflictDamage(opponent, 500);
  assert.ok(responses > 0);
  assert.equal(owner.hand.length, 0);
  assert.equal(cathedral.getCounter("judgment_marker"), 0);
  assert.equal(game.effectEngine.checkOncePerTurn(mage, owner, required(mage.effects[1])).ok, false);
});

test("an activation cost queues the draw until the cost-paying Chain resolves", async (t) => {
  const { game, owner, opponent, cathedral } = setup();
  t.after(() => game.dispose());
  game.turn = opponent.id;
  const flame = new Card(cardDefinition(33), opponent.id);
  opponent.hand.push(flame);
  const order: string[] = [];
  game.on("lp_change", () => { order.push("payment"); assert.equal(owner.hand.length, 0); });
  game.on("chain_link_resolution", event => {
    if (event.stage === "completed") order.push(event.effectId ?? "");
  });
  assert.equal((await game.tryActivateSpell(flame, 0, null, { owner: opponent })).success, true);
  assert.equal(opponent.lp, 7000);
  assert.equal(owner.hand.length, 1);
  assert.equal(cathedral.getCounter("judgment_marker"), 0);
  assert.deepEqual(order, ["payment", "the_black_flame_activation", "shadow_heart_void_mage_draw"]);
});

test("Shield upkeep publishes a loss after payment without a damage counter", async (t) => {
  const { game, owner, opponent, cathedral } = setup();
  t.after(() => game.dispose());
  game.turn = opponent.id;
  game.phase = "standby";
  const host = new Card(cardDefinition(101), opponent.id);
  const shield = new Card(cardDefinition(113), opponent.id);
  shield.equippedTo = host;
  placeFieldCards(opponent.field, host);
  placeFieldCards(opponent.spellTrap, shield);
  await game.emit("standby_phase", { player: opponent, opponent: owner });
  assert.equal(opponent.lp, 7200);
  assert.equal(owner.hand.length, 1);
  assert.equal(cathedral.getCounter("judgment_marker"), 0);
});

test("Luminarch's default lp_change remains gain-only", async (t) => {
  const { game, owner, opponent, mage } = setup();
  t.after(() => game.dispose());
  const blade = new Card(cardDefinition("Luminarch Sunforged Blade"), opponent.id);
  const host = new Card(cardDefinition("Luminarch Valiant - Knight of the Dawn"), opponent.id);
  blade.equippedTo = host;
  placeFieldCards(opponent.field, host);
  placeFieldCards(opponent.spellTrap, blade);
  await game.effectEngine.applyHeal({ type: "heal", player: "opponent", amount: 600 }, {
    player: owner, opponent, source: mage,
  });
  assert.equal(blade.getCounter("solar"), 1);
  await game.inflictDamage(opponent, 600);
  assert.equal(blade.getCounter("solar"), 1);
});

test("effect damage at the end of a Damage Step queues loss triggers", async (t) => {
  const { game, owner, opponent, cathedral } = setup("bot");
  t.after(() => game.dispose());
  game.phase = "battle";
  game.battleStep = "battle";
  const leviathan = new Card(cardDefinition(117), owner.id);
  const attacker = new Card({ name: "Strong attacker", cardKind: "monster", atk: 4000, def: 0 }, opponent.id);
  placeFieldCards(owner.field, leviathan);
  placeFieldCards(opponent.field, attacker);
  await game.resolveCombat(attacker, leviathan);
  assert.equal(opponent.lp, 7200);
  assert.equal(owner.hand.length, 1);
  assert.equal(cathedral.getCounter("judgment_marker"), 1);
});

test("declarative opponent_damage compatibility follows the same Chain collector", async (t) => {
  const { game, owner, opponent, mage, cathedral } = setup();
  t.after(() => game.dispose());
  owner.field.splice(owner.field.indexOf(mage), 1);
  owner.spellTrap.splice(owner.spellTrap.indexOf(cathedral), 1);
  const legacy = new Card({ name: "Legacy damage observer", cardKind: "monster", effects: [{
    id: "legacy_damage", timing: "on_event", event: "opponent_damage", triggerRequirement: "mandatory", triggerTiming: "if",
    actions: [{ type: "draw", player: "self", amount: 1 }],
  }] }, owner.id);
  placeFieldCards(owner.field, legacy);
  await game.inflictDamage(opponent, 500);
  assert.equal(owner.hand.length, 1);
  await game.effectEngine.applyActions([{ type: "pay_lp", amount: 500 }], {
    source: legacy, player: opponent, opponent: owner,
  }, {});
  assert.equal(owner.hand.length, 1);
});

for (const seat of ["player", "bot"] as const) {
  test(`human ${seat} chooses the order of simultaneous LP triggers through the broker`, async t => {
    const { game, owner, opponent, cathedral } = setup(seat);
    t.after(() => game.dispose());
    owner.controllerType = "human";
    let prompts = 0;
    let decisions = 0;
    game.ui.showTriggerOrderModal = async options => {
      prompts++;
      return [...required(required(options).candidates)].reverse().map(candidate => required(candidate.candidateId));
    };
    game.on("decision_made", decision => { if (decision.kind === "segoc_order") decisions++; });
    await game.inflictDamage(opponent, 500);
    assert.equal(prompts, 1);
    assert.equal(decisions, 1);
    assert.equal(owner.hand.length, 1);
    assert.equal(cathedral.getCounter("judgment_marker"), 1);
  });
}

for (const returns of [false, true]) {
  test(`Cathedral source ${returns ? "leaves and returns" : "leaves"} before resolution`, async t => {
    const { game, owner, opponent, cathedral } = setup();
    t.after(() => game.dispose());
    let changed = false;
    game.chainSystem.offerChainResponses = async () => {
      if (!changed) {
        changed = true;
        await game.moveCard(cathedral, owner, "graveyard", { fromZone: "spellTrap", awaitEvents: true });
        if (returns) await game.moveCard(cathedral, owner, "spellTrap", { fromZone: "graveyard", awaitEvents: true });
      }
      return { lastActivator: null, chainBuilt: false, consecutivePasses: 2, offers: 1, activations: 0 };
    };
    await game.inflictDamage(opponent, 500);
    assert.equal(cathedral.getCounter("judgment_marker"), 0);
    assert.equal(owner.hand.length, 1);
  });
}
