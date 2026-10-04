import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { DamageStepEventPayload, DuelEventMap, EventPlayer } from "../src/core/contracts/events.js";
import type { ChainTriggerEntry } from "../src/core/contracts/chainRuntime.js";
import { captureEventReferenceSnapshots } from "../src/core/effects/targeting/references.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./helpers/game.js";

function setup(t: TestContext, seat: "player" | "bot" = "player") {
  const game = createRuntimeGame({ laboratoryMode: true, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = seat; game.turnCounter = 3; game.phase = "main1";
  game.player.controllerType = game.bot.controllerType = "ai";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  game.ui.showChainResponseModal = async () => null;
  return { game, owner: game[seat], opponent: game[seat === "player" ? "bot" : "player"] };
}

function monster(owner: string) { return new Card({ ...cardDefinition(1), effects: [] }, owner); }
function effectCard(id: number, suffix: string, owner: string) {
  const definition = cardDefinition(id);
  const effect = required(definition.effects?.find(candidate => candidate.id.endsWith(suffix)));
  return { source: new Card({ ...definition, effects: [effect] }, owner), effect };
}

function battlePayload(attacker: Card, defender: Card, attackerOwner: EventPlayer, defenderOwner: EventPlayer): DamageStepEventPayload {
  return { attacker, defender, attackerOwner, defenderOwner, target: defender, targetOwner: defenderOwner,
    player: attackerOwner, damageStepId: 1, damageStepTiming: "before_damage_calculation", isDamageStep: true,
    directAttack: false, amount: 0, damageDealt: 0, before: null, after: null, lpGained: 0,
    pendingBattleDestructionCards: [], targetDestroyed: false, attackerDestroyed: false };
}

test("frozen event references preserve Fast-window attack redirect feedback", async t => {
  const { game, owner, opponent } = setup(t);
  const attacker = monster(owner.id), original = monster(opponent.id), redirected = monster(opponent.id);
  placeFieldCards(owner.field, attacker); placeFieldCards(opponent.field, original, redirected);
  const payload: DuelEventMap["attack_declared"] = { attacker, attackerOwner: owner, defender: original,
    defenderOwner: opponent, target: original, targetOwner: opponent };
  game.checkAndOfferTraps = async (_eventName, context) => {
    Object.assign(required(context), { attackRedirect: { target: redirected, targetOwner: opponent },
      redirectedTarget: redirected, redirectedTargetOwner: opponent });
    return { ok: true };
  };
  await game.emit("attack_declared", payload);
  assert.strictEqual(payload.attackRedirect?.target, redirected);
  assert.strictEqual(payload.redirectedTarget, redirected);
  assert.strictEqual(payload.redirectedTargetOwner, opponent);
});

for (const seat of ["player", "bot"] as const) {
  test(`event reference capture ${seat} binds the canonical collector aliases before collection`, t => {
    const { game, owner, opponent } = setup(t, seat);
    const reference = monster(opponent.id); placeFieldCards(opponent.field, reference);
    const definition = cardDefinition(417), effect = required(definition.effects?.find(candidate => candidate.id.endsWith("summon_spore_counter")));
    const target = required(effect.targets?.[0]);
    for (const alias of [
      { event: "after_summon", key: "summonedCard" }, { event: "position_change", key: "changedCard" },
      { event: "card_moved", key: "eventCard" }, { event: "card_to_grave", key: "eventCard" },
      { event: "battle_destroy", key: "battleDestroyer" }, { event: "attack_declared", key: "target" },
      { event: "battle_completed", key: "target" },
    ] as const) {
      const source = new Card({ ...definition, effects: [{ ...effect, event: alias.event,
        targets: [{ ...target, targetFromContext: alias.key }] }] }, owner.id);
      placeFieldCards(owner.spellTrap, source);
      const snapshots = captureEventReferenceSnapshots(game, alias.event, { card: reference, attacker: reference, defender: reference });
      assert.strictEqual(snapshots.find(entry => entry.source === source)?.references[0]?.cards[0]?.card, reference, alias.key);
      owner.spellTrap.splice(owner.spellTrap.indexOf(source), 1);
    }
  });
  for (const stage of ["immediate", "queued"] as const) {
    test(`Rotting Ground ${seat} rejects a source exit and return before ${stage} trigger collection`, async t => {
      const { game, owner, opponent } = setup(t, seat);
      const { source } = effectCard(417, "summon_spore_counter", owner.id);
      const summoned = monster(opponent.id);
      placeFieldCards(owner.spellTrap, source); placeFieldCards(opponent.field, summoned);
      let moved = false;
      const roundTrip = async () => {
        const result = await game.moveCard(source, owner, "hand", { fromZone: "spellTrap", awaitEvents: true });
        moved = typeof result === "boolean" ? result : result.success === true;
        if (!moved) return;
        owner.hand.splice(owner.hand.indexOf(source), 1); source.fieldSlot = null;
        placeFieldCards(owner.spellTrap, source);
      };
      if (stage === "immediate") game.effectEngine.applyImmediateEventEffects = async name => {
        if (name === "after_summon") await roundTrip();
      };
      else game.chainSystem.isPreparingActivation = true;
      await game.emit("after_summon", { card: summoned, player: opponent, opponent: owner, method: "normal", fromZone: "hand" });
      if (stage === "queued") {
        await roundTrip(); game.chainSystem.isPreparingActivation = false;
        await game.flushPendingTriggerOccurrences();
      }
      assert.equal(moved, true); assert.ok(source.locationVersion > 0);
      assert.equal(summoned.getCounter("spore"), 0);
    });
  }
  test(`Overgrowth ${seat} freezes its first host before immediate effects and keeps it after re-equip`, async t => {
    const { game, owner, opponent } = setup(t, seat);
    const { source } = effectCard(415, "standby_spore_counter", owner.id);
    const first = monster(opponent.id), replacement = monster(opponent.id);
    placeFieldCards(opponent.field, first, replacement); placeFieldCards(owner.spellTrap, source);
    source.equippedTo = first;
    game.effectEngine.applyImmediateEventEffects = async () => { source.equippedTo = replacement; };
    await game.emit("standby_phase", { player: owner, opponent });
    assert.equal(first.getCounter("spore"), 1);
    assert.equal(replacement.getCounter("spore"), 0);
  });

  test(`Rotting Ground ${seat} cannot recapture a summon reference after an immediate exit and return`, async t => {
    const { game, owner, opponent } = setup(t, seat);
    const { source } = effectCard(417, "summon_spore_counter", owner.id);
    const summoned = monster(opponent.id); placeFieldCards(opponent.field, summoned); placeFieldCards(owner.spellTrap, source);
    let movementResult: unknown;
    game.effectEngine.applyImmediateEventEffects = async eventName => {
      if (eventName !== "after_summon") return;
      const move = await game.moveCard(summoned, opponent, "hand", { fromZone: "field", awaitEvents: true });
      movementResult = move;
      if (typeof move === "boolean" ? !move : move.success !== true) return;
      opponent.hand.splice(opponent.hand.indexOf(summoned), 1);
      summoned.fieldSlot = null;
      placeFieldCards(opponent.field, summoned);
    };
    await game.emit("after_summon", { player: opponent, opponent: owner, card: summoned, method: "normal", fromZone: "hand" });
    assert.ok(summoned.locationVersion > 0, JSON.stringify(movementResult));
    assert.equal(summoned.getCounter("spore"), 0);
  });

  test(`Overgrowth ${seat} preserves frozen host while the occurrence waits for SEGOC`, async t => {
    const { game, owner, opponent } = setup(t, seat);
    const { source } = effectCard(415, "standby_spore_counter", owner.id);
    const first = monster(opponent.id), replacement = monster(opponent.id);
    placeFieldCards(opponent.field, first, replacement); placeFieldCards(owner.spellTrap, source); source.equippedTo = first;
    game.chainSystem.isPreparingActivation = true;
    await game.emit("standby_phase", { player: owner, opponent });
    source.equippedTo = replacement;
    game.chainSystem.isPreparingActivation = false;
    await game.flushPendingTriggerOccurrences();
    assert.equal(first.getCounter("spore"), 1);
    assert.equal(replacement.getCounter("spore"), 0);
  });

  for (const kind of ["attack", "defense", "mold", "standby", "germination", "summon"] as const) {
    test(`Bloomrot ${kind} reference ${seat} resolves without declaring a target or selecting`, async t => {
      const { game, owner, opponent } = setup(t, seat);
      const id = kind === "mold" ? 406 : kind === "standby" ? 415 : kind === "germination" ? 416 : kind === "summon" ? 417 : 404;
      const suffix = kind === "attack" ? "attack_spore_boost" : kind === "defense" ? "defense_spore_boost" : kind === "mold" ? "attack_spores" : kind === "standby" ? "standby_spore_counter" : kind === "germination" ? "germination_attack" : "summon_spore_counter";
      const { source } = effectCard(id, suffix, owner.id);
      const ref = monster(opponent.id); ref.addCounter("spore", 1);
      placeFieldCards(opponent.field, ref);
      if (id <= 406) placeFieldCards(owner.field, source); else placeFieldCards(owner.spellTrap, source);
      if (kind === "standby") source.equippedTo = ref;
      const targeted: string[] = [];
      game.on("effect_targeted", payload => { targeted.push(String(payload.source?.name)); });
      let selections = 0;
      const startSelection = game.startTargetSelectionSession.bind(game);
      game.startTargetSelectionSession = input => { selections += 1; return startSelection(input); };
      if (kind === "standby") await game.emit("standby_phase", { player: owner, opponent });
      else if (kind === "summon") await game.emit("after_summon", { player: opponent, opponent: owner, card: ref, method: "normal", fromZone: "hand" });
      else if (kind === "germination") await game.emit("attack_declared", { attacker: ref, attackerOwner: opponent, defender: null, defenderOwner: owner, target: null, targetOwner: owner });
      else {
        game.phase = "battle"; game.battleStep = "damage";
        await game.emit("battle_damage", kind === "attack"
          ? battlePayload(source, ref, owner, opponent)
          : battlePayload(ref, source, opponent, owner));
      }
      assert.deepEqual(targeted, []);
      assert.equal(selections, 0);
      if (kind === "attack" || kind === "defense") assert.equal(source.atk, 2500);
      else assert.equal(ref.getCounter("spore"), kind === "mold" ? 3 : 2);
    });
  }

  for (const spores of [0, 1]) {
    test(`Rot-Stag ${seat} requires ${spores === 0 ? "a" : "the present"} Spore counter before battle boost`, async t => {
      const { game, owner, opponent } = setup(t, seat);
      const { source } = effectCard(404, "attack_spore_boost", owner.id);
      const defender = monster(opponent.id); defender.addCounter("spore", spores);
      placeFieldCards(owner.field, source); placeFieldCards(opponent.field, defender);
      game.phase = "battle"; game.battleStep = "damage";
      await game.emit("battle_damage", battlePayload(source, defender, owner, opponent));
      assert.equal(source.atk, spores === 0 ? 2000 : 2500);
    });
  }

  for (const change of ["returned", "copy", "control", "face"] as const) {
    test(`Rotting Ground reference ${seat} rejects ${change} after preparation`, async t => {
      const { game, owner, opponent } = setup(t, seat);
      const { source } = effectCard(417, "summon_spore_counter", owner.id);
      const effect = required(source.effects[0]);
      const summoned = monster(opponent.id);
      placeFieldCards(opponent.field, summoned); placeFieldCards(owner.spellTrap, source);
      const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: owner, opponent,
        effect, activationZone: "spellTrap", committed: true, context: { summonedCard: summoned } });
      assert.ok(game.chainSystem.addToChain(prepared));
      if (change === "returned" || change === "copy") {
        const move = await game.moveCard(summoned, opponent, "hand", { fromZone: "field", awaitEvents: true });
        assert.equal(typeof move === "boolean" ? move : move.success, true);
        if (change === "returned") { opponent.hand.splice(opponent.hand.indexOf(summoned), 1); placeFieldCards(opponent.field, summoned); }
        else placeFieldCards(opponent.field, monster(opponent.id));
      } else if (change === "control") await game.transferControl(summoned, owner);
      else summoned.isFacedown = true;
      await game.chainSystem.resolveChain();
      assert.equal(summoned.getCounter("spore"), 0);
      assert.ok(opponent.field.every(card => card.getCounter("spore") === 0));
    });
  }

  for (const protection of ["target", "effect"] as const) {
    test(`Rotting Ground reference ${seat} checks current ${protection} immunity at resolution`, async t => {
      const { game, owner, opponent } = setup(t, seat);
      const { source } = effectCard(417, "summon_spore_counter", owner.id);
      const effect = required(source.effects[0]); const summoned = monster(opponent.id);
      placeFieldCards(opponent.field, summoned); placeFieldCards(owner.spellTrap, source);
      const prepared = game.chainSystem.createPreparedActivation({ card: source, controller: owner, opponent, effect,
        activationZone: "spellTrap", committed: true, context: { summonedCard: summoned } });
      assert.ok(game.chainSystem.addToChain(prepared));
      if (protection === "target") Object.assign(summoned, { cannotBeTargeted: true });
      else summoned.unaffectedByOtherCardEffects = true;
      await game.chainSystem.resolveChain();
      assert.equal(summoned.getCounter("spore"), protection === "target" ? 1 : 0);
    });
  }
}

test("supplied empty reference snapshots cannot recapture a live context card", async t => {
  const { game, owner, opponent } = setup(t);
  const { source, effect } = effectCard(417, "summon_spore_counter", owner.id);
  const summoned = monster(opponent.id); placeFieldCards(opponent.field, summoned); placeFieldCards(owner.spellTrap, source);
  const entry = required(game.effectEngine.buildTriggerEntry(unsafeFixture<Parameters<typeof game.effectEngine.buildTriggerEntry>[0]>(
    { sourceCard: source, owner, effect, ctx: { source, player: owner, opponent, summonedCard: summoned } },
    "Concrete integration Game exposes narrower player strategy ports than the attached collector projection.")));
  const occurrence = required(game.chainSystem.createTriggerOccurrence("after_summon", { card: summoned, player: opponent, opponent: owner }, {
    entries: [unsafeFixture<ChainTriggerEntry>(entry, "Concrete collector entry exposes narrower strategy callbacks than its Chain consumer projection.")], entriesProvided: true }));
  Reflect.set(occurrence, "referenceSnapshots", []);
  await game.chainSystem.resolveTriggerOccurrences([occurrence]);
  assert.equal(summoned.getCounter("spore"), 0);
});

test("genuine target choices still require a selection", t => {
  const { game, owner, opponent } = setup(t);
  owner.controllerType = "human";
  const { source, effect } = effectCard(404, "special_summon_spore_counter", owner.id);
  const first = monster(opponent.id), second = monster(opponent.id);
  placeFieldCards(owner.field, source); placeFieldCards(opponent.field, first, second);
  const result = game.effectEngine.resolveTargets(required(effect.targets), { source, player: owner, opponent, effect, activationContext: { autoSelectTargets: false } }, null);
  assert.equal(result.needsSelection, true);
});
