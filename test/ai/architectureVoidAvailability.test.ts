import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import { canUseNormalSummonForCard, createNormalSummonRecord } from "../../src/core/Player.js";
import VoidStrategy from "../../src/core/ai/VoidStrategy.js";
import { evaluateVoidFinisherPlans, shouldPlayVoidSpell } from "../../src/core/ai/void/priorities.js";
import { evaluateBoardVoid } from "../../src/core/ai/void/scoring.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { getNormalSummonTributeOptions } from "../../src/core/game/summon/tributeValue.js";
import { cardDefinition, required, unsafeFixture } from "../helpers/fixtures.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import type { NormalSummonPlayerReadView } from "../../src/core/contracts/player.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Seat = "bot" | "player";
type Allowance = "matching" | "wrong" | "exhausted";

function setup(seat: Seat) {
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, disableChains: true });
  game.disablePresentationDelays = true;
  game.turn = seat; game.phase = "main1"; game.turnCounter = 3;
  const owner = game[seat], opponent = game[seat === "bot" ? "player" : "bot"];
  owner.controllerType = "ai"; opponent.controllerType = "ai";
  return { game, owner, opponent };
}

function setAllowance(game: RuntimeGame, seat: Seat, kind: Allowance) {
  const owner = game[seat];
  owner.summonCount = kind === "exhausted" ? 2 : 1;
  owner.normalSummonsThisTurn = [createNormalSummonRecord(new Card(cardDefinition(1), seat)),
    ...(kind === "exhausted" ? [createNormalSummonRecord(new Card(cardDefinition(201), seat))] : [])];
  owner.additionalNormalSummonPermissions = [{ count: 1, filters: { archetype: kind === "wrong" ? "Dragon" : "Void" } }];
}

function policyPlayer(owner: RuntimeGame[Seat]) {
  return { id: owner.id, lp: owner.lp, hand: owner.hand, field: owner.field, deck: owner.deck,
    graveyard: owner.graveyard, banished: owner.banished, extraDeck: owner.extraDeck,
    spellTrap: owner.spellTrap, fieldSpell: owner.fieldSpell, summonCount: owner.summonCount,
    additionalNormalSummons: owner.additionalNormalSummons,
    additionalNormalSummonPermissions: owner.additionalNormalSummonPermissions,
    normalSummonsThisTurn: owner.normalSummonsThisTurn };
}

for (const seat of ["bot", "player"] as const) {
  for (const passiveTarget of ["self", "opponent"] as const) {
    for (const previousNormals of [1, 2] as const) {
      test(`Sealing query retains passive owners and physical references without changing live state (${seat}/${passiveTarget}/${previousNormals})`, async t => {
        const { game, owner, opponent } = setup(seat);
        t.after(() => game.dispose("void_sealing_passive_view"));
        const source = new Card(cardDefinition(216), seat);
        const incoming = new Card(cardDefinition(201), seat);
        const safeTarget = new Card(cardDefinition(204), seat);
        const passiveOwner = passiveTarget === "self" ? owner : opponent;
        const passiveSource = new Card(cardDefinition(1), passiveOwner.id);
        passiveSource.effects = [unsafeFixture<EffectDefinition>({ id: "architecture_void_normal_permission", timing: "passive",
          requireZone: "field", requireFaceup: true,
          passive: { type: "additional_normal_summon", count: 1, targetPlayer: passiveTarget } },
        "The existing Normal-summon query reads legacy targetPlayer; exercise its self/opponent path without extending the closed declarative passive schema.")];
        placeFieldCards(owner.field, safeTarget);
        placeFieldCards(passiveOwner.field, passiveSource);
        owner.hand.push(incoming, source);
        owner.summonCount = previousNormals;
        owner.normalSummonsThisTurn = Array.from({ length: previousNormals }, () => createNormalSummonRecord(safeTarget));
        assert.equal(canUseNormalSummonForCard(owner, incoming), previousNormals === 1);

        const queryGame: { player?: NormalSummonPlayerReadView; bot?: NormalSummonPlayerReadView;
          getOpponent(player: NormalSummonPlayerReadView | null): NormalSummonPlayerReadView | null } = {
          getOpponent(player) { return player === ownView ? otherView : player === otherView ? ownView : null; },
        };
        const ownView = { ...policyPlayer(owner), additionalNormalSummons: owner.additionalNormalSummons + 1, game: queryGame };
        const otherView = { ...policyPlayer(opponent), game: queryGame };
        queryGame[seat] = ownView; queryGame[seat === "bot" ? "player" : "bot"] = otherView;
        const records = owner.normalSummonsThisTurn;
        const physicalField = owner.field, physicalHand = owner.hand;
        assert.equal(ownView.field, physicalField);
        assert.equal(ownView.hand, physicalHand);
        assert.equal(ownView.normalSummonsThisTurn, records);
        assert.equal(canUseNormalSummonForCard(ownView, incoming), true);
        const viewOptions = getNormalSummonTributeOptions(ownView, incoming);
        assert.deepEqual(viewOptions, [[]]);
        // The read view observes the live card, including a later negation.
        passiveSource.effectsNegated = true;
        assert.equal(canUseNormalSummonForCard(ownView, incoming), previousNormals === 1);
        passiveSource.effectsNegated = false;

        const policy = shouldPlayVoidSpell(source, null, policyPlayer(owner), policyPlayer(opponent));
        assert.equal(policy.yes, previousNormals === 2,
          "one relevant hand card warrants Sealing only when its future grant creates an available Normal Summon");
        assert.equal(owner.additionalNormalSummons, 0);
        assert.equal(owner.summonCount, previousNormals);
        assert.equal(owner.normalSummonsThisTurn, records);
        assert.equal(owner.field, physicalField); assert.equal(owner.hand, physicalHand);
        const effect = required(source.effects.find(effect => effect.id === "sealing_the_void_effect"));
        await game.effectEngine.applyActions(effect.actions || [], { source, effect, player: owner, opponent },
          { void_monster_target: [safeTarget] });
        assert.equal(canUseNormalSummonForCard(owner, incoming), true);
        assert.deepEqual(getNormalSummonTributeOptions(owner, incoming), viewOptions);
        const runtime = await game.performNormalSummon(owner, 0, "attack", false);
        assert.equal(runtime?.success, true);
        assert.ok(owner.field.includes(incoming));
      });
    }
  }

  test(`a permission for Hollow does not advertise Conjurer's Normal-Summon pipeline (${seat})`, async t => {
    const { game, owner } = setup(seat);
    t.after(() => game.dispose("void_mixed_availability"));
    owner.summonCount = 1;
    owner.normalSummonsThisTurn = [createNormalSummonRecord(new Card(cardDefinition(1), seat))];
    owner.additionalNormalSummonPermissions = [{ count: 1, filters: { name: "Void Hollow" } }];
    const conjurer = new Card(cardDefinition(201), seat), hollow = new Card(cardDefinition(204), seat);
    owner.hand.push(conjurer, hollow);
    assert.equal(canUseNormalSummonForCard(owner, conjurer), false);
    assert.equal(canUseNormalSummonForCard(owner, hollow), true);
    const analysis = new VoidStrategy(owner).analyzeGameState(game);
    const rejected = await game.performNormalSummon(owner, 0, "attack", false);
    assert.equal(rejected?.success === true, false);
    const accepted = await game.performNormalSummon(owner, 1, "attack", false);
    assert.equal(accepted?.success, true);
    assert.equal(analysis.readyCombos.some(entry => entry.combo?.name === "Conjurer Walker Hollow Pipeline"), false);
  });

  for (const allowance of ["matching", "wrong", "exhausted"] as const) {
    test(`Void analysis and generation reflect the runtime permission (${seat}/${allowance})`, async t => {
      const { game, owner } = setup(seat);
      t.after(() => game.dispose("void_availability"));
      setAllowance(game, seat, allowance);
      const incoming = new Card(cardDefinition(201), seat);
      owner.hand.push(incoming);
      const legal = allowance === "matching";
      assert.equal(canUseNormalSummonForCard(owner, incoming), legal);
      assert.equal(getNormalSummonTributeOptions(owner, incoming).length > 0, legal);
      const strategy = new VoidStrategy(owner);
      const analysis = strategy.analyzeGameState(game);
      const candidates = strategy.generateMainPhaseActions(game);
      const runtime = await game.performNormalSummon(owner, 0, "attack", false);
      assert.equal(runtime?.success === true, legal, "the actual Normal Summon verifies the permission oracle");
      assert.equal(owner.field.includes(incoming), legal);
      assert.equal(analysis.summonAvailable, legal);
      assert.equal(candidates.some(action => action.type === "summon" && action.cardId === incoming.id), legal);
    });

    test(`Arcturus finisher uses the permission for its physical hand card (${seat}/${allowance})`, async t => {
      const { game, owner, opponent } = setup(seat);
      t.after(() => game.dispose("void_finisher_availability"));
      setAllowance(game, seat, allowance);
      const incoming = new Card(cardDefinition(224), seat);
      const materials = [new Card(cardDefinition(204), seat), new Card(cardDefinition(204), seat)];
      owner.hand.push(incoming); placeFieldCards(owner.field, ...materials);
      const legal = allowance === "matching";
      assert.equal(getNormalSummonTributeOptions(owner, incoming).length > 0, legal);
      const plans = evaluateVoidFinisherPlans(policyPlayer(owner), policyPlayer(opponent));
      const runtime = await game.performNormalSummon(owner, 0, "attack", false, [0, 1]);
      assert.equal(runtime?.success === true, legal);
      assert.equal(owner.field.includes(incoming), legal);
      assert.equal(plans.some(plan => plan.kind === "normal_summon" && plan.targetName === incoming.name), legal);
    });
  }

  for (const kind of ["future_grant", "explicit_insufficient", "alternate_name", "non_void_material"] as const) {
    test(`Sealing evaluates the future Normal Summon and canonical materials (${seat}/${kind})`, async t => {
      const { game, owner, opponent } = setup(seat);
      t.after(() => game.dispose("void_sealing_availability"));
      owner.summonCount = 1;
      owner.normalSummonsThisTurn = [createNormalSummonRecord(new Card(cardDefinition(1), seat))];
      const source = new Card(cardDefinition(216), seat), safeTarget = new Card(cardDefinition(204), seat);
      const incoming = new Card(cardDefinition(kind === "alternate_name" || kind === "non_void_material" ? 224 : 201), seat);
      if (kind === "explicit_insufficient") incoming.requiredTributes = 3;
      if (kind === "alternate_name") incoming.altTribute = { requiresName: safeTarget.name, tributes: 1 };
      owner.hand.push(incoming, source); placeFieldCards(owner.field, safeTarget);
      if (kind === "non_void_material") placeFieldCards(owner.field, new Card(cardDefinition(1), seat));
      assert.equal(canUseNormalSummonForCard(owner, incoming), false,
        "Sealing must remain eligible even though its future permission is not present yet");
      const policy = shouldPlayVoidSpell(source, null, policyPlayer(owner), policyPlayer(opponent));
      const effect = required(source.effects.find(effect => effect.id === "sealing_the_void_effect"));
      await game.effectEngine.applyActions(effect.actions || [], { source, effect, player: owner, opponent },
        { void_monster_target: [safeTarget] });
      assert.equal(owner.additionalNormalSummons, 1);
      const options = getNormalSummonTributeOptions(owner, incoming);
      const legal = kind !== "explicit_insufficient";
      assert.equal(options.length > 0, legal);
      const physicalCost = options[0] || [];
      const indices = physicalCost.map(card => owner.field.indexOf(card));
      const runtime = await game.performNormalSummon(owner, 0, "attack", false, indices);
      assert.equal(runtime?.success === true, legal);
      assert.equal(owner.field.includes(incoming), legal);
      if (legal) for (const material of physicalCost) assert.ok(owner.graveyard.includes(material));
      assert.equal(policy.yes, legal, "policy uses the post-grant legal pool without changing its weights or target safety");
    });
  }

  for (const allowance of ["matching", "wrong", "exhausted"] as const) {
    test(`Void board combo availability agrees with the equivalent runtime permission (${seat}/${allowance})`, async t => {
      const { game, owner } = setup(seat);
      t.after(() => game.dispose("void_scoring_availability"));
      setAllowance(game, seat, allowance);
      const incoming = new Card(cardDefinition(201), seat); owner.hand.push(incoming);
      const legal = allowance === "matching";
      const projected = createGameTreeCopy(game, owner).state;
      const score = evaluateBoardVoid(projected, projected.bot);
      // Only the form of the same availability changes; no card, stat or scoring weight changes.
      const equivalent = createGameTreeCopy(game, owner).state;
      equivalent.bot.additionalNormalSummonPermissions = [];
      equivalent.bot.additionalNormalSummons = 0;
      if (legal) {
        equivalent.bot.summonCount = 0;
        equivalent.bot.normalSummonsThisTurn = [];
      }
      const equivalentScore = evaluateBoardVoid(equivalent, equivalent.bot);
      const runtime = await game.performNormalSummon(owner, 0, "attack", false);
      assert.equal(runtime?.success === true, legal);
      assert.equal(score, equivalentScore);
    });
  }
}
