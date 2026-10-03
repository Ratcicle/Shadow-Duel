import assert from "node:assert/strict";
import Bot from "../../src/core/Bot.js";
import LuminarchStrategy from "../../src/core/ai/LuminarchStrategy.js";
import type { AIActionOf } from "../../src/core/contracts/ai.js";
import type { AiLiveGamePort } from "../../src/core/contracts/aiState.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import type { GameOptions } from "../../src/core/contracts/game.js";
import { required, unsafeFixture } from "./fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "./game.js";

export type ProtectorSeat = "player" | "bot";
export const protectorEffect = "luminarch_sanctum_protector_special_summon_hand";

/** Both live execution and independent playback install the same authoritative board. */
export function createProtectorScenario(seat: ProtectorSeat, full = false, options: GameOptions = {}, opposingThreat = true) {
  const first = new Bot("luminarch"); first.id = "player";
  const second = new Bot("luminarch");
  const game = createRuntimeGame({ laboratoryMode: true, laboratoryUseBot: false,
    chainResponseTimeoutMs: 0, captureReplay: false, randomSeed: 803,
    ...options, disableChains: false, opponentOverride: second });
  game.player = unsafeFixture<typeof game.player>(first,
    "A concrete Bot implements the runtime Player in either AI seat.");
  const live = unsafeFixture<BotGamePort & AiLiveGamePort>(game,
    "Concrete Game provides both the AI read port and bot execution methods.");
  first.game = second.game = live;
  const actor = seat === "player" ? first : second;
  const opponent = seat === "player" ? second : first;
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async setup => {
    await start(setup);
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    actor.controllerType = "ai"; opponent.controllerType = "human";
    for (const player of [actor, opponent]) player.deck.push(...player.hand.splice(0));
    const take = (player: typeof actor, id: number) => {
      const zone = player.deck.some(card => card.id === id) ? player.deck : player.extraDeck;
      const card = required(zone.find(card => card.id === id));
      zone.splice(zone.indexOf(card), 1); card.isFacedown = false; card.position = "attack";
      return card;
    };
    actor.hand.push(take(actor, 157));
    placeFieldCards(actor.field, take(actor, 153), take(actor, 1));
    if (full) placeFieldCards(actor.field, take(actor, 1), take(actor, 1), take(actor, 1));
    if (opposingThreat) placeFieldCards(opponent.field, take(opponent, 27));
    opponent.hand.push(take(opponent, 3));
  };
  const initialize = () => game.startWithDecks({ exactDecks: true, preserveDeckOrder: true,
    initializeOnly: true, startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
    playerDeck: [157, 153, 153, 1, 1, 1, 1, 3, 3, 3],
    botDeck: [157, 153, 153, 1, 1, 1, 1, 3, 3, 3], playerExtraDeck: [27], botExtraDeck: [27] });
  const generatedAction = (): AIActionOf<"special_summon_sanctum_protector"> => {
    assert.ok(actor.strategy instanceof LuminarchStrategy);
    const action = required(actor.generateMainPhaseActions(live)
      .find(action => action.type === "special_summon_sanctum_protector"));
    assert.equal(actor.filterValidActionsForCurrentState([action], live).length, 1);
    return action;
  };
  return { game, live, actor, opponent, initialize, generatedAction };
}

/** Drive only the opponent's real legal discard and target requests. */
export async function finishProtectorResponse(game: RuntimeGame, pending: Promise<unknown>,
  discard: RuntimeGame["player"]["hand"][number], target: RuntimeGame["player"]["field"][number]) {
  let done = false;
  const completion = pending.then(() => { done = true; }, () => { done = true; });
  const submitted = new Set<NonNullable<RuntimeGame["targetSelection"]>>();
  const choices: Promise<void>[] = [];
  for (let attempt = 0; attempt < 2000; attempt++) {
    const session = game.targetSelection;
    if (session && !submitted.has(session)) {
      submitted.add(session);
      for (const requirement of session.requirements) {
        const card = requirement.id.includes("discard") ? discard : target;
        const candidate = required(requirement.candidates.find(candidate => candidate.cardRef === card));
        session.selections[requirement.id] = [candidate.key];
      }
      choices.push(game.finishTargetSelection());
    }
    if (done && !game.targetSelection) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done, "activation and opponent selections finish within the bounded driver");
  await completion; await Promise.all(choices); await pending;
  assert.equal(game.targetSelection, null);
}
