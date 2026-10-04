import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { PlayerId } from "../../src/core/contracts/primitives.js";
import type { ReplayDriverGamePort } from "../../src/core/contracts/replay.js";
import { createCanonicalStateSnapshot, hashCanonicalGameState, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { replayCanonicalDuel } from "../../src/core/game/replay/driver.js";
import { hasActivePiercing } from "../../src/core/game/combat/availability.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, type RuntimeGame } from "../helpers/game.js";

type Controller = "human" | "ai";
type Scenario = "king" | "king_cancel" | "mirror_accept" | "mirror_decline" |
  "horizon_accept" | "horizon_decline" | "position" | "rebel" | "copy_opt" | "piercing";
const horizonReturn = "miragebound_false_horizon_return_target";
const sovereignOwn = "miragebound_glass_sovereign_return_self_target";
const sovereignEnemy = "miragebound_glass_sovereign_return_opponent_target";

/** Every fixture card comes from startWithDecks, retaining the Game's duel IDs. */
function installFixture(game: RuntimeGame, seat: PlayerId, controller: Controller, scenario: Scenario) {
  const start = game.startWithDecks.bind(game);
  game.startWithDecks = async options => {
    await start(options);
    game.turn = seat; game.phase = "main1"; game.turnCounter = 4;
    game.phaseDelayMs = 0; game.disablePresentationDelays = true;
    game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
    game.player.controllerType = game.bot.controllerType = "ai";
    const owner = game[seat], opponent = game.getOpponent(owner);
    owner.controllerType = controller;
    for (const player of [owner, opponent]) {
      player.deck = [...player.hand, ...player.deck]; player.hand = [];
      const replacementPolicy = { shouldUseReplacementEffect: () => game.replayMode === "playback"
        ? assert.fail("Playback must consume the recorded replacement choice") : scenario !== "mirror_decline" };
      player.strategy = {
        ...replacementPolicy,
        chooseSpecialSummonPosition: () => game.replayMode === "playback"
          ? assert.fail("Playback must consume the recorded position") : "defense",
        chooseChainResponse: ({ activatable }) => {
          if (game.replayMode === "playback") assert.fail("Playback must consume recorded Chain responses");
          return activatable.find(candidate => scenario.startsWith("horizon") && candidate.card.id === 360) ?? { pass: true };
        },
      };
    }
    const take = (player: Pick<typeof owner, "deck">, id: number) => {
      const card = required(player.deck.find(candidate => candidate.id === id));
      player.deck.splice(player.deck.indexOf(card), 1);
      return card;
    };
    if (scenario === "king" || scenario === "king_cancel") {
      owner.hand.push(take(owner, 358), take(owner, 358));
      placeFieldCards(owner.field, take(owner, 356));
      placeFieldCards(opponent.field, take(opponent, 351));
    } else if (scenario.startsWith("mirror")) {
      game.turn = opponent.id; game.phase = "battle";
      placeFieldCards(owner.spellTrap, take(owner, 359));
      placeFieldCards(owner.field, take(owner, 351), take(owner, 351));
      placeFieldCards(opponent.field, take(opponent, 358), take(opponent, 358));
    } else if (scenario.startsWith("horizon")) {
      game.turn = opponent.id; game.phase = "battle";
      const trap = take(owner, 360); trap.isFacedown = true; trap.setTurn = trap.turnSetOn = 3;
      placeFieldCards(owner.spellTrap, trap); placeFieldCards(owner.field, take(owner, 351));
      placeFieldCards(opponent.field, take(opponent, 358));
    } else if (scenario === "position") {
      placeFieldCards(owner.field, required(owner.extraDeck.shift()), take(owner, 351));
      owner.fieldSpell = take(owner, 354); placeFieldCards(opponent.field, take(opponent, 351));
    } else if (scenario === "rebel") {
      game.phase = "main2";
      placeFieldCards(owner.field, take(owner, 364), take(owner, 364));
    } else if (scenario === "copy_opt") {
      placeFieldCards(owner.field, ...owner.extraDeck.splice(0), take(owner, 351), take(owner, 351));
      placeFieldCards(opponent.field, take(opponent, 351), take(opponent, 351));
    } else {
      const monster = take(owner, 302); monster.effectsNegated = true;
      owner.hand.push(take(owner, 304)); placeFieldCards(owner.field, monster);
      const defender = take(opponent, 351); defender.position = "defense"; placeFieldCards(opponent.field, defender);
    }
  };
}

/** Submit real human sessions, including a resolution refusal after its target changed position. */
async function finishChoices(game: RuntimeGame, action: Promise<unknown>, declineReturn = false) {
  let done = false, failure: unknown, declined = false;
  const completion = action.then(() => { done = true; }, error => { done = true; failure = error; });
  const callbacks = new Set<Promise<void>>();
  for (let attempt = 0; attempt < 3000; attempt++) {
    const session = game.targetSelection;
    if (session) {
      if (declineReturn && session.requirements.some(requirement => requirement.id === horizonReturn)) {
        declined = true; game.cancelTargetSelection();
      } else {
        for (const requirement of session.requirements) {
          const preferred = requirement.id === sovereignOwn || requirement.id === sovereignEnemy
            ? requirement.candidates.find(candidate => candidate.cardRef?.id === 351) : undefined;
          session.selections[requirement.id] = preferred ? [preferred.key] : requirement.candidates.slice(0, requirement.min).map(candidate => candidate.key);
        }
        const pending = game.finishTargetSelection(); callbacks.add(pending);
        void pending.then(() => callbacks.delete(pending), error => { callbacks.delete(pending); failure = error; });
      }
    }
    if (done && !game.targetSelection && callbacks.size === 0) break;
    await new Promise<void>(resolve => setTimeout(resolve, 1));
  }
  assert.ok(done && !game.targetSelection && callbacks.size === 0, "all live decisions must finish");
  await completion;
  if (failure) throw failure;
  if (declineReturn) assert.equal(declined, true, "the optional return must reach its human refusal");
}

async function setup(t: TestContext, seat: PlayerId, controller: Controller, scenario: Scenario,
  playbackController: Controller = controller) {
  t.mock.method(console, "log", () => {});
  const live = createRuntimeGame({ captureReplay: true, randomSeed: 436, laboratoryMode: true, laboratoryUseBot: false,
    chainResponseTimeoutMs: 0, getFieldPlacementMode: () => "manual", fieldPlacementProvider: async () =>
      scenario === "king_cancel" ? { outcome: "cancelled" } : { outcome: "chosen", slot: 4 } });
  const playback = createRuntimeGame({ captureReplay: false, replayMode: "playback", laboratoryMode: true, laboratoryUseBot: false,
    chainResponseTimeoutMs: 0, getFieldPlacementMode: () => assert.fail("Playback must not consult placement preferences"),
    fieldPlacementProvider: async () => assert.fail("Playback must not request placement") });
  t.after(() => { live.dispose(); playback.dispose(); });
  installFixture(live, seat, controller, scenario); installFixture(playback, seat, playbackController, scenario);
  live.ui.showConfirmPrompt = async () => scenario !== "mirror_decline";
  live.ui.showSpecialSummonPositionModal = (_card, choose) => choose("defense");
  live.ui.showTriggerOrderModal = async (options = {}) => (options.candidates ?? []).map(candidate => String(candidate.candidateId));
  live.ui.showChainResponseModal = async candidates => candidates.find(candidate => scenario.startsWith("horizon") && candidate.card?.id === 360) ?? null;
  playback.ui.showConfirmPrompt = async () => assert.fail("Playback must not ask for confirmation");
  playback.ui.showChainResponseModal = async () => assert.fail("Playback must not ask for Chain responses");
  playback.ui.showSpecialSummonPositionModal = () => assert.fail("Playback must not ask for position");
  playback.ui.showTargetSelection = () => assert.fail("Playback must not ask for targets or modes");
  playback.ui.showTriggerOrderModal = async () => assert.fail("Playback must not ask for trigger ordering");
  playback.autoSelector.select = () => assert.fail("Playback must not recompute AI selections");
  playback.autoSelector.orderTriggerCandidates = () => assert.fail("Playback must not recompute AI trigger ordering");
  const deck = [351, 351, 354, 356, 358, 358, 359, 360, 364, 364, 302, 304, ...Array<number>(8).fill(3)];
  const extra = scenario === "copy_opt" ? [355, 355] : [363];
  await live.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true, startAtDrawPhase: true,
    startingPlayer: seat, announceStartingPlayer: false, playerDeck: deck, botDeck: deck, playerExtraDeck: extra, botExtraDeck: extra });
  const initialSnapshot = createCanonicalStateSnapshot(live), initialHash = hashCanonicalGameState(live);
  const playbackStart = playback.startWithDecks.bind(playback);
  playback.startWithDecks = async options => {
    await playbackStart(options);
    assert.equal(hashCanonicalGameState(playback), initialHash, "both Games must begin commands from the same canonical fixture hash");
    assert.deepEqual(createCanonicalStateSnapshot(playback), initialSnapshot);
  };
  const owner = live[seat], opponent = live.getOpponent(owner);
  const select = live.autoSelector.select.bind(live.autoSelector);
  live.autoSelector.select = (contract, context) => {
    const normalized = live.normalizeSelectionContract(contract);
    if (!normalized.ok) return select(contract, context);
    const returnRequirement = normalized.contract.requirements.find(requirement => requirement.id === horizonReturn);
    if (returnRequirement && scenario === "horizon_decline") return { ok: true, selections: { [horizonReturn]: [] } };
    if (scenario === "piercing") {
      const target = normalized.contract.requirements.find(requirement => requirement.id === "lightning_magic_lance_target");
      if (target) return { ok: true, selections: { [target.id]: [required(target.candidates.find(candidate => candidate.cardRef?.id === 302)).key] } };
    }
    if (scenario === "copy_opt" && normalized.contract.requirements.some(requirement => requirement.id === sovereignOwn)) {
      return { ok: true, selections: Object.fromEntries(normalized.contract.requirements.map(requirement => [requirement.id,
        [required(requirement.candidates.find(candidate => candidate.cardRef?.id === 351)).key]])) };
    }
    return select(contract, context);
  };
  const replay = async () => {
    const saved = validateCanonicalReplay(JSON.parse(JSON.stringify(live.finalizeReplay({ reason: "miragebound-p2" }))));
    assert.equal(saved.schemaVersion, 2); assert.equal(saved.engineVersion, "engine-rules-v17");
    const result = await replayCanonicalDuel(saved, { game: unsafeFixture<ReplayDriverGamePort>(playback,
      "Both real Game instances bootstrap the same deterministic fixture before canonical commands execute") });
    assert.equal(result.finalStateHash, saved.result?.finalStateHash);
    assert.deepEqual(createCanonicalStateSnapshot(playback), createCanonicalStateSnapshot(live));
    assert.deepEqual(playback.materialDuelStats, live.materialDuelStats, "material progress must match outside the canonical snapshot");
    assert.equal(playback.decisionBroker.replayCursor, saved.decisions.length);
    return saved;
  };
  return { live, playback, owner, opponent, replay };
}

for (const seat of ["player", "bot"] as const) for (const controller of ["human", "ai"] as const) {
  test(`Miragebound P2 False King procedure replays its return cost and attempt limit (${seat}, ${controller})`, async t => {
    const { live, owner, replay } = await setup(t, seat, controller, "king");
    const king = required(owner.hand.find(card => card.id === 358)), cost = required(owner.field[0]);
    const movements: string[] = [], activated: number[] = [];
    live.on("decision_made", event => { if (event.kind === "field_placement") movements.push("placement"); });
    live.on("card_moved", event => {
      if (event.card === cost) { assert.equal(event.movedByEffect, false); movements.push("cost"); }
      if (event.card === king) movements.push("king");
    });
    live.on("effect_activated", event => { if (typeof event.card?.id === "number") activated.push(event.card.id); });
    await finishChoices(live, live.performHandSummonProcedure(king, owner));
    assert.ok(owner.hand.includes(cost)); assert.ok(owner.field.includes(king));
    assert.equal(king.position, "defense"); assert.equal(king.lastSummonProcedure, "miragebound_false_king_special_summon");
    assert.deepEqual(movements, ["placement", "cost", "king"], "either controller decides placement before paying the procedure cost");
    assert.deepEqual(activated, [], "a procedure does not activate King or Viper");
    assert.notEqual(cost.banishWhenLeavesField, true);
    assert.equal(live.canSummonFromHandByProcedure(required(owner.hand.find(card => card.id === 358)), owner).ok, false);
    const saved = await replay(); assert.deepEqual(saved.commands.map(command => command.type), ["hand_summon_procedure"]);
    assert.ok(saved.decisions.some(decision => decision.kind === "cost"));
    assert.ok(saved.decisions.some(decision => decision.kind === "choice" && "candidateKey" in decision.value && decision.value.candidateKey === "defense"));
  });

  for (const accept of [true, false]) test(`Miragebound P2 Mirror ${accept ? "accepts" : "refuses"} its first battle opportunity (${seat}, ${controller})`, async t => {
    const { live, owner, opponent, replay } = await setup(t, seat, controller, accept ? "mirror_accept" : "mirror_decline");
    const first = required(owner.field[0]), second = required(owner.field[1]);
    const attackers = [...opponent.field];
    let confirmations = 0;
    live.on("decision_made", event => { if (event.kind === "choice") confirmations++; });
    await finishChoices(live, live.resolveCombat(required(attackers[0]), first));
    assert.equal(confirmations, 1);
    assert.equal(owner.hand.includes(first), accept); assert.equal(owner.graveyard.includes(first), !accept);
    await finishChoices(live, live.resolveCombat(required(attackers[1]), second));
    assert.ok(owner.graveyard.includes(second)); assert.equal(confirmations, 1, "refusing also consumes the first opportunity");
    const saved = await replay(); assert.deepEqual(saved.commands.map(command => command.type), ["attack", "attack"]);
    assert.equal(saved.decisions.filter(decision => decision.kind === "choice").length, 1);
  });

  for (const accept of [true, false]) test(`Miragebound P2 Horizon ${accept ? "accepts" : "refuses"} its resolution return (${seat}, ${controller})`, async t => {
    const { live, owner, opponent, replay } = await setup(t, seat, controller, accept ? "horizon_accept" : "horizon_decline");
    const trap = required(owner.spellTrap[0]), own = required(owner.field[0]), attacker = required(opponent.field[0]);
    const targets: number[] = [];
    live.on("effect_targeted", event => { if ((event.source === trap || event.sourceCard === trap) && event.target?.duelCardId) targets.push(event.target.duelCardId); });
    live.on("card_moved", event => { if (event.card === own && event.toZone === "hand") assert.equal(attacker.position, "defense", "the optional return follows the actual shift"); });
    await finishChoices(live, live.resolveCombat(attacker, own), !accept && controller === "human");
    assert.equal(attacker.position, "defense"); assert.equal(owner.hand.includes(own), accept); assert.equal(owner.field.includes(own), !accept);
    assert.ok(owner.graveyard.includes(trap)); assert.deepEqual(targets, [attacker.duelCardId], "the own resolution choice is not an activation target");
    const saved = await replay(); assert.deepEqual(saved.commands.map(command => command.type), ["attack"]);
    assert.ok(saved.decisions.some(decision => decision.kind === "chain_response" && "candidateKey" in decision.value));
    assert.ok(saved.decisions.some(decision => decision.kind === "choice"));
  });

  test(`Miragebound P2 immediate Leviathan precedes the mandatory Oasis trigger (${seat}, ${controller})`, async t => {
    const { live, owner, opponent, replay } = await setup(t, seat, controller, "position");
    const leviathan = required(owner.field[0]), scout = required(owner.field[1]), changed = required(opponent.field[0]);
    const order: string[] = [];
    const capture = live.chainSystem.createTriggerOccurrence.bind(live.chainSystem);
    live.chainSystem.createTriggerOccurrence = (...args) => {
      if (args[0] === "position_change") { assert.equal(changed.atk, 1100); order.push("immediate"); }
      const occurrence = capture(...args);
      return occurrence && "sequence" in occurrence ? occurrence : null;
    };
    live.on("effect_activated", event => {
      assert.notEqual(event.card, leviathan, "Leviathan's immediate observer does not create an activation");
      if (event.effectId === "miragebound_oasis_position_debuff") { assert.equal(changed.atk, 1100); order.push("oasis"); }
    });
    await finishChoices(live, live.tryActivateMonsterEffect(scout, null, "field", owner, { effectId: "miragebound_scout_switch_position" }));
    assert.equal(changed.position, "defense"); assert.equal(changed.atk, 700); assert.equal(changed.def, 300);
    assert.deepEqual(order, ["immediate", "oasis"]);
    assert.equal(live.materialDuelStats[seat].effectActivationsByMaterialId.get(363) ?? 0, 0);
    assert.equal(live.materialDuelStats[seat].effectActivationsByMaterialId.get(351), 1);
    const saved = await replay(); assert.deepEqual(saved.commands.map(command => command.type), ["activate_effect"]);
  });

  test(`Miragebound P2 both Rebels return during the same mandatory End Phase (${seat}, ${controller})`, async t => {
    const { live, owner, replay } = await setup(t, seat, controller, "rebel");
    const rebels = [...owner.field], moves: number[] = [];
    live.on("card_moved", event => { if (rebels.some(card => card === event.card) && event.toZone === "hand" && event.card.duelCardId) moves.push(event.card.duelCardId); });
    live.ui.showConfirmPrompt = async () => assert.fail("Both End Phase returns are mandatory");
    await finishChoices(live, live.nextPhase());
    assert.equal(live.phase, "end"); assert.equal(owner.field.length, 0); assert.equal(moves.length, 2);
    assert.ok(rebels.every(card => owner.hand.includes(card)));
    assert.equal(live.materialDuelStats[seat].effectActivationsByMaterialId.get(364), 2);
    const saved = await replay(); assert.deepEqual(saved.commands.map(command => command.type), ["phase_intent"]);
    assert.equal(saved.decisions.some(decision => decision.kind === "choice"), false);
  });

  test(`Miragebound P2 Sovereign copy limits remain separate through replay (${seat}, ${controller})`, async t => {
    const { live, owner, opponent, replay } = await setup(t, seat, controller, "copy_opt");
    const sovereigns = owner.field.filter(card => card.id === 355);
    assert.equal(sovereigns.length, 2);
    for (const [index, source] of sovereigns.entries()) {
      const action = live.tryActivateMonsterEffect(source, null, "field", owner, { effectId: "miragebound_glass_sovereign_bounce" });
      await finishChoices(live, action); assert.equal((await action).success, true);
      const effect = required(source.effects.find(entry => entry.id === "miragebound_glass_sovereign_bounce"));
      assert.equal(live.canUseOncePerTurn(source, owner, effect).ok, false);
      const next = sovereigns[index + 1];
      if (next) assert.equal(live.canUseOncePerTurn(next, owner, effect).ok, true, "the unused second copy retains its activation");
      const snapshot = createCanonicalStateSnapshot(live).players[seat].zones.field.find(card => card?.duelCardId === source.duelCardId);
      assert.equal(required(snapshot).oncePerTurnUsageByName.miragebound_glass_sovereign_bounce, 4, "the snapshot preserves the turn on which this copy was used");
    }
    assert.equal(owner.field.length, 2); assert.equal(opponent.field.length, 0);
    const saved = await replay(); assert.deepEqual(saved.commands.map(command => command.type), ["activate_effect", "activate_effect"]);
  });

  test(`P2 external piercing grant on a negated monster survives capture and playback (${seat}, ${controller})`, async t => {
    const { live, owner, opponent, replay } = await setup(t, seat, controller, "piercing");
    const source = required(owner.hand[0]), attacker = required(owner.field[0]), defender = required(opponent.field[0]);
    await finishChoices(live, live.tryActivateSpell(source, 0, null, { owner }));
    assert.equal(attacker.effectsNegated, true); assert.equal(attacker.piercingGrantedByEffect, true); assert.equal(hasActivePiercing(attacker), true);
    const lp = opponent.lp;
    assert.equal(attacker.atk, 2000); assert.equal(defender.def, 1000);
    await finishChoices(live, live.nextPhase()); assert.equal(live.phase, "battle");
    await finishChoices(live, live.resolveCombat(attacker, defender));
    assert.equal(opponent.lp, lp - 1000, "an external grant still deals piercing while the monster's own effects are negated");
    const saved = await replay(); assert.deepEqual(saved.commands.map(command => command.type), ["activate_card", "phase_intent", "attack"]);
  });
}

for (const seat of ["player", "bot"] as const) test(`Miragebound P2 cancelled King placement replays with AI control (${seat})`, async t => {
  const { live, owner, replay } = await setup(t, seat, "human", "king_cancel", "ai");
  const king = required(owner.hand[0]), cost = required(owner.field[0]);
  const result = await live.performHandSummonProcedure(king, owner, { materials: [cost], position: "defense" });
  assert.equal(result.cancelled, true); assert.ok(owner.hand.includes(king)); assert.ok(owner.field.includes(cost));
  assert.equal(live.canSummonFromHandByProcedure(king, owner).ok, true);
  const saved = await replay(); assert.deepEqual(saved.commands.map(command => command.type), ["hand_summon_procedure"]);
  assert.equal(saved.decisions.length, 1); assert.equal(saved.decisions[0]?.kind, "field_placement");
});
