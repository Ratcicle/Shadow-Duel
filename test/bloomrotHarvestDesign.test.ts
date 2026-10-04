import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import Card from "../src/core/Card.js";
import type { ReplayDecisionInput } from "../src/core/contracts/decisions.js";
import type { ActiveSelectionSession } from "../src/core/contracts/selection.js";
import type { ReplayDriverGamePort } from "../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../src/core/game/replay/driver.js";
import { cardDefinition, required, unsafeFixture } from "./helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "./helpers/game.js";

function setup(t: TestContext, amount: number, seat: "player" | "bot" = "player", human = false) {
  const game = createRuntimeGame({ laboratoryMode: true, randomSeed: 414, chainResponseTimeoutMs: 0 });
  t.after(() => game.dispose());
  game.turn = seat; game.phase = "main1"; game.turnCounter = 3;
  game.player.controllerType = game.bot.controllerType = "ai";
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.waitForPresentationDelay = async () => {};
  game.waitForAiPresentationStep = async () => {};
  const owner = game[seat], opponent = seat === "player" ? game.bot : game.player;
  owner.controllerType = human ? "human" : "ai";
  const source = new Card(cardDefinition(414), owner.id);
  const ally = new Card({ ...cardDefinition(401), effects: [] }, owner.id);
  const first = new Card({ ...cardDefinition(1), effects: [] }, opponent.id);
  const second = new Card({ ...cardDefinition(1), effects: [] }, opponent.id);
  placeFieldCards(owner.field, ally); placeFieldCards(opponent.field, first, second);
  first.addCounter("spore", amount); owner.hand.push(source);
  const decisions: ReplayDecisionInput[] = [];
  game.on("decision_made", decision => { decisions.push(decision); });
  const run = () => game.tryActivateSpell(source, owner.hand.indexOf(source), null, { owner });
  return { game, owner, opponent, source, ally, first, second, decisions, run };
}

async function driveChoices(game: RuntimeGame, pending: Promise<unknown>,
  choose: (session: ActiveSelectionSession) => Promise<void> | void) {
  let done = false;
  let failure: unknown;
  const completion = pending.then(() => { done = true; }, error => { done = true; failure = error; });
  let choices = 0;
  for (let attempt = 0; attempt < 1500; attempt++) {
    if (game.targetSelection) { choices++; await choose(game.targetSelection); }
    if (done && !game.targetSelection) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done, "the public activation must finish after explicit human choices");
  await completion;
  if (failure) throw failure;
  return choices;
}

test("Harvest still buffs after removing fewer than four Spores", async t => {
  const { game, source, ally, first, opponent, run } = setup(t, 1);
  const result = await run();
  assert.equal(first.getCounter("spore"), 0);
  assert.equal(result.success, true);
  assert.deepEqual([ally.atk, ally.def], [required(cardDefinition(401).atk) + 100, required(cardDefinition(401).def) + 100]);
  assert.equal(opponent.field.length, 2);
  assert.ok(game.player.graveyard.includes(source));
});

for (const seat of ["player", "bot"] as const) {
  for (const amount of [1, 4, 8]) {
    test(`Harvest removes ${amount} Spores before the human resolution choice (${seat})`, async t => {
      const fixture = setup(t, amount, seat, true);
      const { game, owner, opponent, source, ally, first, second, decisions, run } = fixture;
      game.autoSelector.select = () => assert.fail("Human resolution choices must not consult AutoSelector");
      let responseState: unknown;
      const offer = game.chainSystem.offerChainResponses.bind(game.chainSystem);
      game.chainSystem.offerChainResponses = async (...args) => {
        const link = game.chainSystem.chainStack.find(entry => entry.card === source);
        if (link && responseState === undefined) responseState = {
          counters: first.getCounter("spore"), targets: Object.keys(link.targetSelections || {}),
        };
        return offer(...args);
      };
      let targeted = 0;
      game.on("effect_targeted", event => { if (event.source === source || event.card === source) targeted++; });
      const order: string[] = [];
      game.on("card_to_grave", event => {
        if (event.card === first || event.card === second) {
          assert.equal(ally.atk, cardDefinition(401).atk, "buff follows each completed destruction");
          order.push(event.card === first ? "first" : "second");
        }
      });
      const pending = run();
      const choices = await driveChoices(game, pending, async session => {
        assert.equal(session.kind, "choice");
        assert.equal(session.owner, owner);
        assert.equal(first.getCounter("spore"), 0);
        assert.equal(ally.atk, cardDefinition(401).atk);
        assert.ok(owner.spellTrap.includes(source));
        const requirement = required(session.requirements.find(entry => entry.id === "destroy_targets"));
        assert.equal(requirement.min, 0); assert.equal(requirement.max, Math.floor(amount / 4));
        assert.deepEqual(requirement.candidates.map(candidate => candidate.cardRef), [first, second]);
        // Pick the second copy first; definition ID alone cannot represent this choice.
        session.selections.destroy_targets = [...requirement.candidates].reverse()
          .slice(0, requirement.max).map(candidate => candidate.key);
        await game.finishTargetSelection();
      });
      assert.equal((await pending).success, true);
      assert.deepEqual(responseState, { counters: amount, targets: [] });
      assert.equal(targeted, 0);
      assert.equal(choices, amount < 4 ? 0 : 1);
      assert.deepEqual(order, amount < 4 ? [] : amount === 4 ? ["second"] : ["second", "first"]);
      assert.equal(opponent.field.length, 2 - Math.floor(amount / 4));
      assert.deepEqual([ally.atk, ally.def], [required(cardDefinition(401).atk) + amount * 100,
        required(cardDefinition(401).def) + amount * 100]);
      assert.ok(owner.graveyard.includes(source));
      const choicesRecorded = decisions.filter(decision => decision.kind === "choice");
      assert.equal(choicesRecorded.length, amount < 4 ? 0 : 1);
      if (amount >= 4) assert.equal(required(choicesRecorded[0]).actorId, seat);
      game.cleanupTempBoosts(owner);
      assert.deepEqual([ally.atk, ally.def], [cardDefinition(401).atk, cardDefinition(401).def]);
    });
  }

  for (const refusal of ["empty", "cancel"] as const) {
    test(`Harvest human ${refusal} refusal preserves the bonus (${seat})`, async t => {
      const { game, ally, first, second, opponent, decisions, run } = setup(t, 4, seat, true);
      game.autoSelector.select = () => assert.fail("Human refusal cannot use AutoSelector");
      const pending = run();
      assert.equal(await driveChoices(game, pending, async session => {
        assert.equal(session.kind, "choice");
        assert.equal(required(session.requirements[0]).min, 0);
        if (refusal === "cancel") game.cancelTargetSelection();
        else { session.selections.destroy_targets = []; await game.finishTargetSelection(); }
      }), 1);
      assert.equal((await pending).success, true);
      assert.equal(first.getCounter("spore"), 0);
      assert.deepEqual(opponent.field, [first, second]);
      assert.equal(ally.atk, required(cardDefinition(401).atk) + 400);
      assert.deepEqual(required(decisions.find(decision => decision.kind === "choice")).value,
        { selections: { destroy_targets: [] } });
    });
  }

  test(`Harvest with no opposing candidates still buffs (${seat})`, async t => {
    const { game, owner, opponent, ally, first, run } = setup(t, 4, seat, true);
    await game.moveCard(first, opponent, "graveyard", { fromZone: "field", awaitEvents: true });
    await game.moveCard(required(opponent.field[0]), opponent, "graveyard", { fromZone: "field", awaitEvents: true });
    ally.addCounter("spore", 4);
    game.autoSelector.select = () => assert.fail("No candidates do not require AutoSelector");
    game.ui.showTargetSelection = () => assert.fail("No candidates do not require a selection prompt");
    assert.equal((await run()).success, true);
    assert.equal(owner.field[0]?.getCounter("spore"), 0);
    assert.equal(ally.atk, required(cardDefinition(401).atk) + 400);
  });
}

for (const selectedCount of [0, 1, 2]) {
  test(`Harvest AI records an exact optional choice of ${selectedCount} cards after eight Spores`, async t => {
    const { game, owner, source, ally, first, second, opponent, decisions } = setup(t, 8);
    const selected = [second, first].slice(0, selectedCount);
    const result = await game.tryActivateSpell(source, 0, null, { owner, activationContext: {
      decisions: { selections: { destroy_targets: selected.map(card => card.instanceId) } },
    } });
    assert.equal(result.success, true);
    assert.equal(opponent.field.length, 2 - selectedCount);
    assert.equal(ally.atk, required(cardDefinition(401).atk) + 800);
    assert.deepEqual(required(decisions.find(decision => decision.kind === "choice")).value, {
      selections: { destroy_targets: selected.map(card => ({ duelCardId: card.duelCardId, cardId: card.id,
        effectId: null, candidateKey: null, key: null })) },
    });
  });
}

for (const invalid of ["stale", "duplicate", "too_many"] as const) {
  test(`Harvest rejects ${invalid} exact AI choices without choosing another card`, async t => {
    const { game, owner, source, ally, first, second, opponent } = setup(t, 4);
    const selected = invalid === "stale" ? ["missing"] : invalid === "duplicate"
      ? [first.instanceId, first.instanceId] : [first.instanceId, second.instanceId];
    const result = await game.tryActivateSpell(source, 0, null, { owner, activationContext: {
      decisions: { selections: { destroy_targets: selected } },
    } });
    assert.equal(result.success, false);
    assert.deepEqual(opponent.field, [first, second]);
    assert.equal(ally.atk, cardDefinition(401).atk);
  });
}

test("Harvest continues to the bonus when every chosen card is immune", async t => {
  const { game, owner, source, ally, first, opponent } = setup(t, 4);
  first.immuneToOpponentEffectsUntilTurn = game.turnCounter;
  const result = await game.tryActivateSpell(source, 0, null, { owner, activationContext: {
    decisions: { selections: { destroy_targets: [first.instanceId] } },
  } });
  assert.equal(result.success, true);
  assert.ok(opponent.field.includes(first));
  assert.equal(ally.atk, required(cardDefinition(401).atk) + 400);
});

test("Harvest may choose a facedown backrow and a Field Spell at resolution", async t => {
  const { game, owner, source, ally, opponent, first } = setup(t, 8);
  const backrow = new Card({ ...cardDefinition(419), effects: [] }, opponent.id);
  const fieldSpell = new Card({ ...cardDefinition(410), effects: [] }, opponent.id);
  opponent.hand.push(backrow, fieldSpell);
  await game.moveCard(backrow, opponent, "spellTrap", { fromZone: "hand", isFacedown: true });
  await game.moveCard(fieldSpell, opponent, "fieldSpell", { fromZone: "hand", isFacedown: false });
  const result = await game.tryActivateSpell(source, 0, null, { owner, activationContext: {
    decisions: { selections: { destroy_targets: [backrow.instanceId, fieldSpell.instanceId] } },
  } });
  assert.equal(result.success, true);
  assert.ok(opponent.graveyard.includes(backrow)); assert.ok(opponent.graveyard.includes(fieldSpell));
  assert.ok(opponent.field.includes(first));
  assert.equal(ally.atk, required(cardDefinition(401).atk) + 800);
});

for (const seat of ["player", "bot"] as const) {
  test(`set Harvest uses the same public late optional choice (${seat})`, async t => {
    const { game, owner, source, ally, first, opponent } = setup(t, 4, seat, true);
    owner.controllerType = "ai";
    assert.equal((await game.setSpellOrTrap(source, 0, owner)).ok, true);
    owner.controllerType = "human";
    // This is a previously Set Spell, eligible on the following turn.
    game.turnCounter++;
    game.autoSelector.select = () => assert.fail("A set Harvest's human choice cannot use AutoSelector");
    const pending = game.tryActivateSpellTrapEffect(source, null, { owner, activationZone: "spellTrap" });
    await driveChoices(game, pending, async session => {
      assert.equal(session.kind, "choice"); assert.equal(first.getCounter("spore"), 0);
      session.selections.destroy_targets = []; await game.finishTargetSelection();
    });
    const result = await pending;
    assert.equal(result.success, true, result.reason ?? undefined);
    assert.equal(opponent.field.length, 2);
    assert.ok(owner.graveyard.includes(source));
    assert.equal(ally.atk, required(cardDefinition(401).atk) + 400);
  });
}

for (const mutation of ["leave", "return", "replacement"] as const) {
  test(`Harvest does not destroy a stale human choice after ${mutation}`, async t => {
    const { game, opponent, ally, first, run } = setup(t, 4, "player", true);
    const pending = run();
    await driveChoices(game, pending, async session => {
      const candidate = required(required(session.requirements[0]).candidates.find(entry => entry.cardRef === first));
      session.selections.destroy_targets = [candidate.key];
      await game.moveCard(first, opponent, "graveyard", { fromZone: "field", awaitEvents: true });
      if (mutation === "return") await game.moveCard(first, opponent, "field", {
        fromZone: "graveyard", summonOrigin: "effect_resolution", position: "attack",
      });
      if (mutation === "replacement") {
        placeFieldCards(opponent.field, new Card({ ...cardDefinition(1), effects: [] }, opponent.id));
      }
      await game.finishTargetSelection();
    });
    assert.equal((await pending).success, true);
    assert.equal(opponent.field.length, mutation === "leave" ? 1 : 2);
    assert.equal(ally.atk, required(cardDefinition(401).atk) + 400);
  });
}

test("Harvest revalidates each selected presence between sequential destructions", async t => {
  const { game, owner, source, opponent, ally, first, second } = setup(t, 8);
  game.on("card_to_grave", async event => {
    if (event.card !== first) return;
    await game.moveCard(second, opponent, "graveyard", { fromZone: "field", awaitEvents: true });
    await game.moveCard(second, opponent, "field", {
      fromZone: "graveyard", summonOrigin: "effect_resolution", position: "attack",
    });
  });
  const result = await game.tryActivateSpell(source, 0, null, { owner, activationContext: {
    decisions: { selections: { destroy_targets: [first.instanceId, second.instanceId] } },
  } });
  assert.equal(result.success, true);
  assert.deepEqual(opponent.field, [second]);
  assert.equal(ally.atk, required(cardDefinition(401).atk) + 800);
});

test("a normal Harvest resolves from its committed source when the source leaves during responses", async t => {
  const { game, owner, source, ally, first, run } = setup(t, 1);
  const offer = game.chainSystem.offerChainResponses.bind(game.chainSystem);
  let moved = false;
  game.chainSystem.offerChainResponses = async (...args) => {
    if (!moved && game.chainSystem.chainStack.some(entry => entry.card === source)) {
      moved = true;
      await game.moveCard(source, owner, "graveyard", { fromZone: "spellTrap", awaitEvents: true });
    }
    return offer(...args);
  };
  assert.equal((await run()).success, true);
  assert.equal(first.getCounter("spore"), 0);
  assert.equal(ally.atk, required(cardDefinition(401).atk) + 100);
});

for (const unavailable of ["absent", "immune"] as const) {
  test(`mandatory destruction still halts when its candidates are ${unavailable}`, async t => {
    const { game, owner, opponent, source, first, second } = setup(t, 4);
    owner.deck.push(new Card({ ...cardDefinition(3), effects: [] }, owner.id));
    if (unavailable === "absent") {
      await game.moveCard(first, opponent, "graveyard", { fromZone: "field", awaitEvents: true });
      await game.moveCard(second, opponent, "graveyard", { fromZone: "field", awaitEvents: true });
    } else {
      first.immuneToOpponentEffectsUntilTurn = game.turnCounter;
      second.immuneToOpponentEffectsUntilTurn = game.turnCounter;
    }
    const result = await game.effectEngine.applyActions([
      { type: "destroy_targeted_cards", minTargets: 1, maxTargets: 1 },
      { type: "draw", amount: 1, player: "self" },
    ], { source, player: owner, opponent }, {});
    assert.ok(result && typeof result === "object");
    assert.equal(result.success, false);
    assert.equal(owner.deck.length, 1);
  });
}

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const selectedCount of [0, 2]) {
      test(`Harvest canonical replay preserves ${selectedCount} late choices (${seat}/${controller})`, async t => {
        const live = createRuntimeGame({ captureReplay: true, laboratoryMode: true, laboratoryUseBot: false,
          randomSeed: 414, chainResponseTimeoutMs: 0 });
        const playback = createRuntimeGame({ replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false,
          chainResponseTimeoutMs: 0 });
        t.after(() => { live.dispose(); playback.dispose(); });
        for (const game of [live, playback]) {
          const start = game.startWithDecks.bind(game);
          game.startWithDecks = async options => {
            await start(options);
            game.turn = seat; game.phase = "main1"; game.turnCounter = 3;
            game.player.controllerType = game.bot.controllerType = "human";
            const owner = game[seat], opponent = game.getOpponent(owner);
            owner.controllerType = controller;
            game.disablePresentationDelays = true;
            game.waitForBoardPresentation = async () => {};
            game.waitForPresentationDelay = async () => {};
            game.waitForAiPresentationStep = async () => {};
            const ownCards = [...owner.hand, ...owner.deck], otherCards = [...opponent.hand, ...opponent.deck];
            const source = required(ownCards.find(card => card.id === 414));
            const ally = required(ownCards.find(card => card.id === 401));
            const opponents = otherCards.filter(card => card.id === 1);
            owner.hand = [source]; owner.deck = ownCards.filter(card => card.id === 3);
            opponent.hand = []; opponent.deck = otherCards.filter(card => card.id === 3);
            placeFieldCards(owner.field, ally); placeFieldCards(opponent.field, ...opponents);
            required(opponents[0]).addCounter("spore", 8);
          };
        }
        live.ui.showConfirmPrompt = async () => true;
        live.ui.showChainResponseModal = async () => null;
        if (controller === "human") live.autoSelector.select = () => assert.fail("Human resolution must use the broker");
        playback.ui.showConfirmPrompt = async () => assert.fail("Replay must consume recorded confirmations");
        playback.ui.showChainResponseModal = async () => assert.fail("Replay must consume recorded response passes");
        playback.ui.showTargetSelection = () => assert.fail("Replay must consume recorded late choices");
        playback.autoSelector.select = () => assert.fail("Replay must not recompute AI choices");
        const ownerDeck = [414, 401, ...Array<number>(18).fill(3)];
        const otherDeck = [1, 1, ...Array<number>(18).fill(3)];
        await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
          startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
          playerDeck: seat === "player" ? ownerDeck : otherDeck,
          botDeck: seat === "bot" ? ownerDeck : otherDeck, playerExtraDeck: [], botExtraDeck: [] });
        const owner = live[seat], opponent = live.getOpponent(owner), source = required(owner.hand[0]);
        const selected = [...opponent.field].reverse().slice(0, selectedCount);
        const pending = live.tryActivateSpell(source, 0, null, { owner,
          ...(controller === "ai" ? { activationContext: {
            decisions: { selections: { destroy_targets: selected.map(card => card.instanceId) } },
          } } : {}),
        });
        await driveChoices(live, pending, async session => {
          const requirement = required(session.requirements.find(entry => entry.id === "destroy_targets"));
          if (selectedCount === 0) live.cancelTargetSelection();
          else {
            session.selections.destroy_targets = selected.map(card =>
              required(requirement.candidates.find(candidate => candidate.cardRef === card)).key);
            await live.finishTargetSelection();
          }
        });
        assert.equal((await pending).success, true);
        assert.equal(opponent.field.length, 2 - selectedCount);
        assert.equal(owner.field[0]?.atk, required(cardDefinition(401).atk) + 800);
        const saved = validateCanonicalReplay(live.finalizeReplay({ reason: "harvest-design" }));
        const choices = saved.decisions.filter(decision => decision.kind === "choice");
        assert.equal(choices.length, 1); assert.equal(required(choices[0]).actorId, seat);
        assert.equal(saved.commands[0]?.type, "activate_card");
        assert.ok(!saved.decisions.some(decision => decision.kind === "target"));
        const result = await replayCanonicalDuel(saved, { game: unsafeFixture<ReplayDriverGamePort>(playback,
          "Both concrete Games install the same deterministic fixture before public recorded commands.") });
        assert.equal(result.ok, true); assert.equal(result.finalStateHash, saved.result?.finalStateHash);
        assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
        assert.equal(playback.decisionBroker.replayCursor, saved.decisions.length);
      });
    }
  }
}
