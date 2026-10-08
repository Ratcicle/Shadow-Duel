import assert from "node:assert/strict";
import test from "node:test";
import Bot from "../../src/core/Bot.js";
import { buildPrioritizedAction } from "../../src/core/ai/common/actionGeneration.js";
import { createGameTreeCopy } from "../../src/core/ai/common/gameTreeSimulation.js";
import { applyGenericSimulatedMainPhaseAction } from "../../src/core/ai/common/simulation.js";
import { getPlanningActionPresence } from "../../src/core/ai/common/actionIdentity.js";
import { fingerprintMainPhaseAction } from "../../src/core/bot/mainPhaseIdentity.js";
import type { AIAction } from "../../src/core/contracts/ai.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { EffectDefinition } from "../../src/core/contracts/effects.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards } from "../helpers/game.js";

for (const actor of ["bot", "player"] as const) {
  for (const kind of ["monsterEffect", "graveyardMonsterEffect", "graveyardSpellEffect", "spellTrapEffect", "position_change"] as const) {
    test(`a generated ${kind} follows its physical source after same-zone reordering (${actor})`, async t => {
      const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, disableChains: true });
      t.after(() => game.dispose("architecture_source_reordering"));
      game.turn = actor; game.phase = "main1"; game.turnCounter = 4; game.disablePresentationDelays = true;
      game.waitForAiPresentationStep = async () => {}; game.waitForBoardPresentation = async () => {};
      const owner = Object.assign(new Bot("dragon"), { oncePerDuelUsageByName: {} as Record<string, number> }); owner.id = actor; game[actor] = owner;
      const port = unsafeFixture<BotGamePort>(game, "Concrete Game supports Bot execution; public EffectEngine projection is narrower.");
      owner.game = port;
      const zone: "spellTrap" | "graveyard" | "field" = kind === "spellTrapEffect" ? "spellTrap" : kind.startsWith("graveyard") ? "graveyard" : "field";
      const id = kind === "graveyardSpellEffect" || kind === "spellTrapEffect" ? 219 : 256;
      const filler = required(game.createCardForOwner(id, owner));
      const source = required(game.createCardForOwner(id, owner));
      const sibling = required(game.createCardForOwner(id, owner));
      const effect: EffectDefinition = { id: "architecture_source_draw", timing: "ignition", activationZones: [zone],
        oncePerTurn: true, oncePerTurnScope: "card", actions: [{ type: "draw", amount: 1, player: "self" }] };
      source.effects = [effect]; sibling.effects = [effect];
      source.summonedTurn = 0; sibling.summonedTurn = 4;
      sibling.effectsNegated = true;
      if (zone === "field" || zone === "spellTrap") placeFieldCards(owner[zone], filler, source, sibling);
      else owner[zone].push(filler, source, sibling);
      owner.deck.push(required(game.createCardForOwner(256, owner)));
      const input = { card: source, priority: 1, sourceBinding: { controllerId: actor, zone, game } };
      const generated: AIAction = kind === "position_change"
        ? buildPrioritizedAction({ ...input, type: kind, fieldIndex: 1, extra: { toPosition: "defense" } })
        : kind === "monsterEffect"
          ? buildPrioritizedAction({ ...input, type: kind, fieldIndex: 1, effect })
          : kind === "spellTrapEffect"
            ? buildPrioritizedAction({ ...input, type: kind, zoneIndex: 1, effect })
            : buildPrioritizedAction({ ...input, type: kind, graveyardIndex: 1, effect });
      owner.strategy.generateMainPhaseActions = () => [generated];
      const action = required(owner.generateMainPhaseActions(port).find(candidate => candidate.type === kind));
      assert.ok(getPlanningActionPresence(action));
      const key = fingerprintMainPhaseAction(action, port, owner);
      const sourceVersion = source.locationVersion;
      await game.moveCard(filler, owner, zone === "graveyard" ? "deck" : "graveyard", { fromZone: zone });
      assert.equal(owner[zone][0], source); assert.equal(owner[zone][1], sibling);
      assert.equal(source.locationVersion, sourceVersion, "only the preceding card changes zones");
      assert.equal(fingerprintMainPhaseAction(action, port, owner), key, "index movement does not change a bound command's identity");
      assert.equal(owner.filterValidActionsForCurrentState([action], port).length, 1);
      const { state } = createGameTreeCopy(game, owner);
      let observedInstance: string | number | undefined;
      const options: NonNullable<Parameters<typeof applyGenericSimulatedMainPhaseAction>[2]> = { onEffectActivated: payload => {
        const card: unknown = Reflect.get(payload, "card");
        const id: unknown = card && typeof card === "object" ? Reflect.get(card, "instanceId") : undefined;
        if (typeof id === "number" || typeof id === "string") observedInstance = id;
      } };
      applyGenericSimulatedMainPhaseAction(state, action, options);
      if (kind === "position_change") {
        assert.equal(state.bot.field[0]?.position, "defense");
        assert.equal(state.bot.field[1]?.position, "attack");
      } else {
        assert.equal(observedInstance, source.instanceId);
        assert.equal(state.bot.hand.length, 1);
      }
      let runtimeSource: unknown;
      const pipeline = game.runActivationPipeline.bind(game);
      game.runActivationPipeline = async input => { runtimeSource = input?.card; return pipeline(input); };
      assert.equal(await owner.executeMainPhaseAction(port, action), true);
      if (kind === "position_change") {
        assert.equal(source.position, "defense"); assert.equal(sibling.position, "attack");
      } else {
        assert.equal(owner.hand.length, 1);
        assert.equal(runtimeSource, source, "the real activation pipeline receives the bound source");
      }
    });
  }
}
