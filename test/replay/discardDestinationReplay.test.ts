import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import type { GameCard } from "../../src/core/contracts/cards.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { setLocale } from "../../src/core/i18n.js";
import { required } from "../helpers/fixtures.js";
import { completeTestSelections, createRuntimeGame } from "../helpers/game.js";
import { discardReplayDeck, installDiscardScenario, type DiscardReplayPayload, type DiscardScenario } from "../helpers/discardProjectionReplay.js";

for (const seat of ["player", "bot"] as const) {
  for (const controller of ["human", "ai"] as const) {
    const scenarios: DiscardScenario[] = ["redirect-empty", "redirect-existing", "facedown"];
    if (controller === "human") scenarios.push("fill-last-slot", "pass-response");
    for (const scenario of scenarios) {
      test(`discard replay in a fresh process ${seat}/${controller}/${scenario}`, { timeout: 20000 }, async t => {
        setLocale("en");
        const game = createRuntimeGame({ captureReplay: true, randomSeed: 6641, laboratoryMode: true,
          laboratoryUseBot: false, chainResponseTimeoutMs: 0 });
        t.after(() => { game.dispose(); setLocale("en"); });
        installDiscardScenario(game, seat, controller, scenario);
        await game.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
          startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
          playerDeck: discardReplayDeck, botDeck: discardReplayDeck, playerExtraDeck: [], botExtraDeck: [] });
        const owner = game[seat], source = required(owner.hand[0]);
        const initialHand = [...owner.hand], initialGrave = [...owner.graveyard];
        const inventory = () => [game.player, game.bot].flatMap(player => [
          ...player.hand, ...player.field, ...player.graveyard, ...player.banished,
          ...player.deck, ...player.extraDeck, ...player.spellTrap,
          ...(player.fieldSpell ? [player.fieldSpell] : []),
        ]);
        const before = inventory(), identities = new Map(before.map(card => [card, card.instanceId]));
        const assertConserved = () => {
          const after = inventory();
          assert.equal(after.length, before.length);
          for (const card of before) {
            assert.equal(after.filter(candidate => candidate === card).length, 1);
            assert.equal(card.instanceId, identities.get(card));
          }
        };
        const rejected = scenario === "redirect-empty", lateFailure = scenario === "fill-last-slot";
        const redirected = scenario === "redirect-existing";
        assert.equal(game.effectEngine.canActivateSpellFromHandPreview(source, owner).ok, !rejected);
        const discarded: GameCard[] = [], summoned: GameCard[] = [];
        let offeredResponse = false, choseResponse = false, partialFailure = false;
        const haunted = owner.spellTrap.find(card => card.id === 18);
        game.ui.showChainResponseModal = async candidates => {
          const candidate = candidates.find(candidate => candidate.card === haunted);
          if (candidate && !choseResponse) {
            offeredResponse = true;
            assert.deepEqual(owner.hand, initialHand.slice(1));
            assert.equal(discarded.length, 0, "responses happen before committing discards");
            if (lateFailure) { choseResponse = true; return candidate; }
          }
          return null;
        };
        game.ui.showConfirmPrompt = async () => false;
        game.ui.showTriggerOrderModal = async options => options?.optional ? [] : (options?.candidates || []).map(candidate => candidate.candidateId);
        game.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
        if (controller === "human") game.autoSelector.select = () => assert.fail("human decisions cannot use AI");
        game.on("card_moved", event => {
          assertConserved();
          const discardedCard = initialHand.find(card => card !== source && card === event.card);
          if (event.fromZone === "hand" && discardedCard) {
            discarded.push(discardedCard);
            assert.equal(event.contextLabel, "discard");
            assert.equal(event.toZone, redirected ? "banished" : "graveyard");
            if (lateFailure) assert.equal(owner.field.length, 5, "the legal response fills the field before discard");
          }
        });
        game.on("after_summon", event => {
          if (event.player === owner) summoned.push(required(before.find(card => card === event.card)));
        });
        game.on("chain_link_resolution", event => {
          if (event.stage !== "completed" || event.effectId !== "shadow_heart_infusion") return;
          partialFailure = event.outcome === "partial_failure";
          assert.equal(event.activationNegated, false);
          if (lateFailure) assert.equal(event.executed, true);
        });
        const pending = game.tryActivateSpell(source, 0, null, { owner });
        await completeTestSelections(game, pending);
        const result = await pending;
        assert.equal(result.success, !rejected && !lateFailure);
        assert.equal(discarded.length, rejected ? 0 : 2);
        assert.equal(summoned.length, rejected ? 0 : 1);
        assert.equal(partialFailure, lateFailure);
        assertConserved();
        assert.equal(game.targetSelection, null);
        assert.equal(game.chainSystem.chainStack.length, 0);
        assert.equal(game.effectUsageReservations.size, 0);
        assert.equal(game.chainSystem.checkActivationUsage(source, owner, required(source.effects[0])).ok, rejected);
        if (rejected) assert.deepEqual(owner.hand, initialHand);
        else {
          assert.ok(owner[redirected ? "banished" : "graveyard"].includes(source));
          assert.equal(new Set(discarded).size, 2);
          if (redirected) assert.equal(summoned[0], initialGrave[0]);
          if (lateFailure || scenario === "pass-response") {
            assert.equal(offeredResponse, true);
            assert.equal(choseResponse, lateFailure);
            assert.equal(owner.field.length, 5);
            assert.deepEqual(owner.hand, initialHand.slice(3), "the third physical copy remains in hand");
            assert.ok(discarded.every(card => owner.graveyard.includes(card)), "committed discards are never refunded");
            assert.ok(initialGrave.some(card => owner.graveyard.includes(card)));
          }
          if (lateFailure) {
            assert.ok("chainBuilt" in result && result.chainBuilt === true);
            assert.ok("failedAction" in result && result.failedAction === "special_summon_from_zone");
            assert.equal(required(summoned[0]).cannotAttackThisTurn, false, "only Haunted's response summon occurred");
          } else assert.equal(required(summoned[0]).cannotAttackThisTurn, true);
        }
        const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(game.finalizeReplay({ reason: "discard-projection-regression" }))));
        assert.equal(replay.commands.length, 1);
        const payload: DiscardReplayPayload = { seat, controller, scenario, replay,
          snapshot: createCanonicalStateSnapshot(game), random: game.getRandomState() };
        const child = spawnSync(process.execPath, ["--import=tsx", "--import=./scripts/register_node_asset_loader.ts",
          "--input-type=module", "--eval",
          'import { replayDiscardScenarioFromStdin } from "./test/helpers/discardProjectionReplay.ts"; await replayDiscardScenarioFromStdin();',
        ], { input: JSON.stringify(payload), encoding: "utf8", timeout: 15000 });
        assert.equal(child.status, 0, `${child.error?.message || ""}\n${child.stdout}\n${child.stderr}`);
      });
    }
  }
}
