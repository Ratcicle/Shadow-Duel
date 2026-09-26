import { placeFieldCards } from "./helpers/game.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { required, unsafeFixture } from "./helpers/fixtures.js";
import Card from "../src/core/Card.js";
import type Renderer from "../src/ui/Renderer.js";
import { showChainResponseModal } from "../src/ui/renderer/trapModals.js";
import { createRuntimeGame } from "./helpers/game.js";

import { cardDatabaseByName } from "./helpers/fixtures.js";

for (const trapOwnerId of ["player", "bot"] as const) {
  for (const accept of [true, false]) {
    test(`Down of the Fool resolves the summon response modal (${trapOwnerId}, accept=${accept})`, async (t) => {
      const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
      t.after(() => game.dispose());
      const owner = game[trapOwnerId];
      const opponent = trapOwnerId === "player" ? game.bot : game.player;
      game.turn = opponent.id;
      game.phase = "main1";
      game.turnCounter = 2;
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = async () => {};
      game.player.controllerType = game.bot.controllerType = "human";
      const trap = new Card(required(cardDatabaseByName.get("Down of the Fool")), owner.id);
      trap.isFacedown = true;
      trap.setTurn = 1;
      placeFieldCards(owner.spellTrap, trap);
      const monster = new Card(required(cardDatabaseByName.get("Nightmare Steed")), opponent.id);
      opponent.hand.push(monster);
      const otherMonster = new Card(required(cardDatabaseByName.get("Nightmare Steed")), opponent.id);
      placeFieldCards(opponent.field, otherMonster);
      let prompts = 0;
      game.ui.showChainResponseModal = async (candidates, context) => {
        const candidate = required(candidates.find((entry) => entry.card === trap));
        prompts++;
        const selected = await showChainResponseModal.call(
          unsafeFixture<Renderer>({
            showUnifiedTrapModal: async () => accept ? {
              card: trap, effect: candidate.effect, activate: true,
            } : null,
          }, "Headless test supplies the user's answer to the real Chain response modal adapter."),
          candidates,
          context,
        );
        return selected == null ? null : required(candidates.find((entry) => entry === selected));
      };
      const result = await game.performNormalSummon(opponent, 0, "attack", false);
      assert.equal(result?.success, true);
      assert.equal(prompts, 1);
      assert.equal(opponent.graveyard.includes(monster), accept);
      assert.equal(opponent.field.includes(monster), !accept);
      assert.ok(opponent.field.includes(otherMonster), "Only the summoned monster is the target");
      assert.equal(owner.graveyard.includes(trap), accept);
      assert.equal(owner.spellTrap.includes(trap), !accept);
      assert.equal(game.targetSelection, null);
      assert.equal(game.chainSystem.isOpenGameState(), true);
    });
  }
}

for (const scenario of ["1600 ATK", "1599 ATK", "Special Summon", "own summon", "set this turn"] as const) {
  test(`Down of the Fool respects activation requirements: ${scenario}`, async (t) => {
    const game = createRuntimeGame({ laboratoryMode: true, captureReplay: false });
    t.after(() => game.dispose());
    const summoner = scenario === "own summon" ? game.player : game.bot;
    game.turn = summoner.id;
    game.phase = "main1";
    game.turnCounter = 2;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = async () => {};
    game.player.controllerType = game.bot.controllerType = "human";
    const trap = new Card(required(cardDatabaseByName.get("Down of the Fool")), game.player.id);
    trap.isFacedown = true;
    trap.setTurn = scenario === "set this turn" ? 2 : 1;
    placeFieldCards(game.player.spellTrap, trap);
    const monster = new Card({
      id: 99015, name: "Summon response target", cardKind: "monster",
      level: 4, atk: scenario === "1599 ATK" ? 1599 : 1600, def: 1000,
    }, summoner.id);
    summoner.hand.push(monster);
    let prompts = 0;
    game.ui.showChainResponseModal = async (candidates) => {
      prompts++;
      return required(candidates.find((entry) => entry.card === trap));
    };
    if (scenario === "Special Summon") {
      await game.moveCard(monster, summoner, "field", {
        fromZone: "hand", summonMethodOverride: "special", position: "attack",
        isFacedown: false, summonOrigin: "effect_resolution", summonProcedure: "card_effect",
      });
    } else {
      await game.performNormalSummon(summoner, 0, "attack", false);
    }
    const shouldActivate = scenario === "1600 ATK";
    assert.equal(prompts, shouldActivate ? 1 : 0);
    assert.equal(summoner.graveyard.includes(monster), shouldActivate);
    assert.equal(game.player.graveyard.includes(trap), shouldActivate);
    assert.equal(game.player.spellTrap.includes(trap), !shouldActivate);
  });
}

test("Down of the Fool preserves the requested text and Normal Summon trigger", () => {
  const card = cardDatabaseByName.get("Down of the Fool");
  assert.ok(card);

  const effect = required(card.effects).find(
    (entry) => entry.id === "down_of_the_fool_destroy_summoned_monster",
  );
  assert.ok(effect);
  assert.equal(effect.event, "after_summon");
  assert.equal(effect.requireOpponentSummon, true);
  assert.deepEqual(effect.summonMethods, ["normal"]);
  assert.equal(
    required(required(effect.targets)[0]).targetFromContext,
    "summonedCard",
  );
  assert.equal(required(required(effect.targets)[0]).minAtk, 1600);
  assert.equal(required(required(effect.actions)[0]).type, "destroy");

  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    locale.cards["15"].description,
    "Quando seu oponente Invocar por Invocação-Normal um monstro com 1600 ou mais de ATK: escolha esse monstro; destrua-o.",
  );
});
