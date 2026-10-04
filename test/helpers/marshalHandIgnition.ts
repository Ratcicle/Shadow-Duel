import assert from "node:assert/strict";
import Bot from "../../src/core/Bot.js";
import LuminarchStrategy from "../../src/core/ai/LuminarchStrategy.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { required, unsafeFixture } from "./fixtures.js";
import { createRuntimeGame, placeFieldCards } from "./game.js";

export const marshalEffectId = "luminarch_celestial_marshal_hand_summon";
export function marshalScenario(seat: "player" | "bot", options: { full?: boolean; lp?: number; playback?: boolean; human?: boolean } = {}) {
  const first = new Bot("luminarch"), second = new Bot("luminarch");
  first.id = "player";
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false, chainResponseTimeoutMs: 0,
    captureReplay: !options.playback, randomSeed: 84155, replayMode: options.playback ? "playback" : "live", opponentOverride: second });
  game.player = unsafeFixture<typeof game.player>(first, "Concrete Bot supplies the Player capabilities in the mirrored seat.");
  const live = unsafeFixture<BotGamePort & AiLiveGamePort>(game, "Concrete Game provides AI read and execution ports.");
  first.game = second.game = live;
  const actor = seat === "player" ? first : second, opponent = seat === "player" ? second : first;
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async configuration => {
    await start(configuration);
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    actor.controllerType = options.human ? "human" : "ai"; opponent.controllerType = "human";
    actor.lp = options.lp ?? 8000;
    for (const owner of [actor, opponent]) owner.deck.push(...owner.hand.splice(0));
    const take = (id: number, owner = actor) => {
      const card = required(owner.deck.find(card => card.id === id));
      owner.deck.splice(owner.deck.indexOf(card), 1);
      card.isFacedown = false; card.position = "attack"; card.summonedTurn = 0;
      return card;
    };
    actor.hand.push(take(155), take(155)); placeFieldCards(actor.field, take(1));
    if (options.full) {
      placeFieldCards(actor.field, take(1), take(1), take(9));
      const haunted = take(18);
      haunted.isFacedown = true; haunted.setTurn = haunted.turnSetOn = 1;
      placeFieldCards(actor.spellTrap, haunted); actor.graveyard.push(take(9));
    }
    const leviathan = required(opponent.extraDeck.find(card => card.id === 27));
    opponent.extraDeck.splice(opponent.extraDeck.indexOf(leviathan), 1);
    leviathan.isFacedown = false; leviathan.position = "attack"; leviathan.summonedTurn = 0;
    leviathan.properSummonEstablished = true; leviathan.properSummonProcedure = "synchro";
    placeFieldCards(opponent.field, leviathan); opponent.hand.push(take(3, opponent));
    for (const owner of [actor, opponent]) for (const card of [...owner.field, ...owner.spellTrap]) game.effectEngine.assignFieldPresenceId(card);
  };
  const deck = [155, 155, 1, 1, 1, 9, 3, 3, 18, 9, 4, 5, 7, 8, 10, 11, 12, 13, 14, 15];
  const initialize = () => game.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
    startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
    playerDeck: deck, botDeck: deck, playerExtraDeck: [27], botExtraDeck: [27] });
  const generate = () => {
    assert.ok(actor.strategy instanceof LuminarchStrategy);
    const action = required(actor.generateMainPhaseActions(live).find(action => action.type === "handIgnition" && action.cardId === 155));
    assert.equal(action.type, "handIgnition");
    assert.equal(actor.filterValidActionsForCurrentState([action], live).length, 1);
    return action;
  };
  return { game, live, actor, opponent, initialize, generate };
}
