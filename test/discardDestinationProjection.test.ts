import assert from "node:assert/strict";
import test from "node:test";
import Card from "../src/core/Card.js";
import { createCanonicalStateSnapshot } from "../src/core/game/replay/canonical.js";
import { cardDefinition, required } from "./helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame, placeFieldCards } from "./helpers/game.js";

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    for (const mode of ["redirect-empty", "redirect-existing", "facedown", "negated", "absent", "full"] as const) {
      test(`discard preview and activation ${seat}/${controller}/${mode}`, async t => {
        const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
        t.after(() => game.dispose());
        game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
        game.disablePresentationDelays = true;
        game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
        game.player.controllerType = game.bot.controllerType = "human";
        const owner = game[seat], opponent = seat === "player" ? game.bot : game.player;
        owner.controllerType = controller;
        const make = (id: number) => new Card(cardDefinition(id), owner.id);
        const source = make(110), first = make(101), second = make(101), existing = make(101);
        owner.hand.push(source, first, second);
        if (mode === "redirect-existing") owner.graveyard.push(existing);
        if (mode === "full") placeFieldCards(owner.field, ...Array.from({ length: 5 }, () => make(1)));
        if (mode !== "absent" && mode !== "full") {
          const galaxy = new Card(cardDefinition(273), opponent.id);
          galaxy.isFacedown = mode === "facedown";
          galaxy.effectsNegated = mode === "negated";
          placeFieldCards(opponent.field, galaxy);
        }
        const inventory = () => [owner, opponent].flatMap(player => [
          ...player.hand, ...player.field, ...player.graveyard, ...player.banished,
          ...player.deck, ...player.extraDeck, ...player.spellTrap,
          ...(player.fieldSpell ? [player.fieldSpell] : []),
        ]);
        const before = inventory();
        const versions = new Map(before.map(card => [card, card.locationVersion]));
        const identities = new Map(before.map(card => [card, card.instanceId]));
        const assertConserved = () => {
          const after = inventory();
          assert.equal(after.length, before.length);
          for (const card of before) {
            assert.equal(after.filter(candidate => candidate === card).length, 1);
            assert.equal(card.instanceId, identities.get(card));
          }
        };
        const rejected = mode === "redirect-empty" || mode === "full";
        const redirected = mode === "redirect-empty" || mode === "redirect-existing";
        game.chainSystem.checkActivationUsage(source, owner, required(source.effects[0]));
        const snapshot = createCanonicalStateSnapshot(game);
        assert.equal(game.effectEngine.canActivateSpellFromHandPreview(source, owner).ok, !rejected);
        assert.deepEqual(createCanonicalStateSnapshot(game), snapshot, "preview is read-only");
        const discarded: Card[] = [], summoned: Card[] = [];
        let movements = 0, graveEvents = 0, targeted = 0;
        game.on("card_moved", event => {
          movements++;
          assertConserved();
          const discardedCard = [first, second].find(card => card === event.card);
          if (discardedCard) {
            if (event.fromZone !== "hand") return;
            discarded.push(discardedCard);
            assert.equal(event.contextLabel, "discard");
            assert.equal(event.toZone, redirected ? "banished" : "graveyard");
          }
        });
        game.on("card_to_grave", event => { if (event.card === first || event.card === second) graveEvents++; });
        game.on("effect_targeted", () => { targeted++; });
        game.on("spell_activated", event => {
          if (event.card === source) assert.deepEqual(owner.hand, [first, second], "discard happens during resolution");
        });
        game.on("after_summon", event => {
          if (event.player !== owner) return;
          assert.equal(discarded.length, 2, "both discards precede the summon");
          const revived = [first, second, existing].find(card => card === event.card);
          if (revived) summoned.push(revived);
        });
        game.ui.showChainResponseModal = async () => null;
        game.ui.showConfirmPrompt = async () => false;
        game.ui.showTriggerOrderModal = async options => options?.optional ? [] : (options?.candidates || []).map(candidate => candidate.candidateId);
        game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
        if (controller === "human") game.autoSelector.select = () => assert.fail("human choices cannot invoke AI");
        const pending = game.tryActivateSpell(source, 0, null, { owner });
        await completeTestSelections(game, pending);
        const result = await pending;
        assert.equal(result.success, !rejected);
        assert.equal(targeted, 0);
        assertConserved();
        assert.equal(game.chainSystem.chainStack.length, 0);
        assert.equal(game.targetSelection, null);
        assert.equal(game.chainSystem.checkActivationUsage(source, owner, required(source.effects[0])).ok, rejected);
        if (rejected) {
          assert.equal(movements, 0);
          assert.deepEqual(owner.hand, [source, first, second]);
          assert.deepEqual(createCanonicalStateSnapshot(game), snapshot);
        } else {
          assert.deepEqual(new Set(discarded), new Set([first, second]));
          assert.equal(graveEvents, redirected ? 0 : 2);
          assert.equal(summoned.length, 1);
          const revived = required(summoned[0]);
          if (redirected) assert.equal(revived, existing);
          assert.equal(revived.cannotAttackThisTurn, true);
          assert.ok(owner[redirected ? "banished" : "graveyard"].includes(source));
          for (const card of [first, second]) {
            assert.equal(card.locationVersion, (versions.get(card) || 0) + (revived === card ? 2 : 1));
          }
        }
      });
    }
  }
}
