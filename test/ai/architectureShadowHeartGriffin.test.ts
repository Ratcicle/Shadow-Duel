import assert from "node:assert/strict";
import test from "node:test";
import Card from "../../src/core/Card.js";
import ShadowHeartStrategy from "../../src/core/ai/ShadowHeartStrategy.js";
import { shouldSummonMonster } from "../../src/core/ai/shadowheart/summonPolicy.js";
import { getNormalSummonTributeOptions } from "../../src/core/game/summon/tributeValue.js";
import { cardDefinition, required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const seat of ["bot", "player"] as const) {
  test(`Griffin generation preserves its legal empty-field Normal Summon (${seat})`, async t => {
    const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, disableChains: true });
    t.after(() => game.dispose("architecture_griffin"));
    game.disablePresentationDelays = true;
    game.turn = seat; game.phase = "main1"; game.turnCounter = 2;
    const owner = game[seat];
    owner.controllerType = "ai";
    const griffin = new Card(cardDefinition(114), seat);
    const mage = new Card(cardDefinition(118), seat);
    owner.hand.push(griffin, mage);
    const opponent = game[seat === "bot" ? "player" : "bot"];
    placeFieldCards(opponent.field, new Card(cardDefinition(303), opponent.id));
    const strategy = new ShadowHeartStrategy(owner);
    const requirement = strategy.getTributeRequirementFor(griffin, owner);
    assert.equal(requirement.tributesNeeded, 0);
    assert.equal(requirement.usingAlt, true);
    assert.equal(requirement.alt && "tributes" in requirement.alt, false,
      "the empty-field alternate is a typed procedure, without a numeric tributes field");
    assert.deepEqual(getNormalSummonTributeOptions(owner, griffin), [[]]);
    const decision = shouldSummonMonster(griffin, strategy.analyzeGameState(game), requirement,
      { field: owner.field, oppField: opponent.field });
    assert.equal(decision.yes, true);
    assert.equal(decision.priority, 7, "the established Griffin policy weight is preserved");
    const candidates = strategy.generateMainPhaseActions(game);
    const runtime = await game.performNormalSummon(owner, 0, "attack", false);
    assert.equal(runtime?.success, true);
    assert.equal(owner.field.includes(griffin), true);
    assert.equal(owner.graveyard.length, 0);
    const action = required(candidates.find(candidate => candidate.type === "summon" && candidate.cardId === 114));
    assert.ok(action.type === "summon");
    assert.equal(action.position, "attack");
    assert.equal(action.facedown, false);
    assert.equal(action.index, 0);
  });

  for (const explicitCost of [undefined, 2]) {
    test(`Griffin's empty-field alternative does not erase a nonempty-field cost (${seat}/${explicitCost ?? "level"})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, captureReplay: false, disableChains: true });
      t.after(() => game.dispose("architecture_griffin_cost"));
      game.disablePresentationDelays = true;
      game.turn = seat; game.phase = "main1"; game.turnCounter = 2;
      const owner = game[seat];
      owner.controllerType = "ai";
      const griffin = new Card(cardDefinition(114), seat);
      if (explicitCost !== undefined) griffin.requiredTributes = explicitCost;
      owner.hand.push(griffin);
      const material = new Card(cardDefinition(101), seat);
      placeFieldCards(owner.field, material);
      const strategy = new ShadowHeartStrategy(owner);
      const requirement = strategy.getTributeRequirementFor(griffin, owner);
      assert.equal(requirement.tributesNeeded, explicitCost ?? 1);
      assert.equal(requirement.usingAlt, false);
      const legal = getNormalSummonTributeOptions(owner, griffin);
      const candidates = strategy.generateMainPhaseActions(game);
      const runtime = await game.performNormalSummon(owner, 0, "attack", false, [0]);
      if (explicitCost === undefined) {
        assert.deepEqual(legal, [[material]]);
        assert.equal(runtime?.success, true);
        assert.equal(owner.field.includes(griffin), true);
        assert.equal(owner.graveyard.includes(material), true);
      } else {
        assert.deepEqual(legal, []);
        assert.equal(runtime?.success === true, false);
        assert.equal(owner.hand.includes(griffin), true);
        assert.equal(owner.field.includes(material), true);
        assert.equal(candidates.some(candidate => candidate.type === "summon" && candidate.cardId === 114), false);
      }
    });
  }
}
