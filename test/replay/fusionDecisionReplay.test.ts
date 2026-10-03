import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test, { type TestContext } from "node:test";
import Bot from "../../src/core/Bot.js";
import { MainPhaseSession } from "../../src/core/bot/mainPhaseSession.js";
import type { BotGamePort } from "../../src/core/contracts/bot.js";
import { createCanonicalStateSnapshot, validateCanonicalReplay } from "../../src/core/game/replay/canonical.js";
import { required, unsafeFixture } from "../helpers/fixtures.js";
import { createRuntimeGame } from "../helpers/game.js";

type Seat = "player" | "bot";
type Mode = "executor" | "planned" | "default" | "defense" | "twins" | "human" | "destination" | "unique" | "human-retry";

async function recordFusion(t: TestContext, seat: Seat, mode: Mode) {
  const first = new Bot("shadowheart"); first.id = "player";
  const second = new Bot("shadowheart");
  const game = createRuntimeGame({ opponentOverride: second, captureReplay: true, randomSeed: 42, chainResponseTimeoutMs: 0 });
  game.player = unsafeFixture<typeof game.player>(first, "Real Bot implements the runtime player in either physical seat.");
  const runtime = unsafeFixture<BotGamePort>(game, "Concrete Game implements the bot execution port.");
  first.game = second.game = runtime;
  t.after(() => game.dispose());
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
  game.ui.showChainResponseModal = async () => null;
  const deck = mode === "unique" ? [3,3,3,3,3,3,3,104,111,12]
    : mode === "twins" ? [3,3,3,3,3,3,104,111,111,12] : [3,3,3,3,3,111,116,104,111,12];
  await game.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
    startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
    playerDeck: deck, botDeck: deck, playerExtraDeck: mode === "destination" ? [121,122] : [121],
    botExtraDeck: mode === "destination" ? [121,122] : [121] });
  // Fixture phase is a supported serialized command, so playback needs no setup hook.
  game.phase = "main1";
  game.recordReplayCommand({ type: "set_phase", actorId: seat, payload: { phase: "main1" } });
  const owner = seat === "player" ? first : second;
  const source = required(owner.hand.find(card => card.id === 12));
  const action = required(owner.generateMainPhaseActions(runtime).find(candidate => candidate.type === "spell" && candidate.cardId === 12));
  assert.equal(owner.filterValidActionsForCurrentState([action], runtime).length, 1);
  const materials = owner.hand.filter(card => card.cardKind === "monster");
  const options = game.effectEngine.getAvailableFusions(owner.extraDeck, materials, game[seat],
    { materialInfo: materials.map(() => ({ zone: "hand" as const })) });
  assert.ok(required(options[0]).materialCombos.length >= (mode === "unique" ? 1 : 2));
  if (mode === "human" || mode === "human-retry") {
    owner.controllerType = "human";
    game.autoSelector.select = () => assert.fail("Human fusion must remain manual");
    let positions = 0;
    game.ui.showSpecialSummonPositionModal = (_card, onChoice) => { positions++; onChoice("defense"); };
    const activation = game.tryActivateSpell(source, owner.hand.indexOf(source), null, { owner });
    for (const [kind, choices] of [
      ["fusion_select", [required(owner.extraDeck.find(card => card.id === 121))]],
      ...(mode === "human-retry" ? [["fusion_materials", [required(materials.find(card => card.id === 104)), required(materials.find(card => card.id === 116))]]] as const : []),
      ["fusion_materials", [required(materials.find(card => card.id === 111)), required(materials.find(card => card.id === 104))]],
    ] as const) {
      for (let attempt = 0; attempt < 300 && game.targetSelection?.kind !== kind; attempt++) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      const selection = required(game.targetSelection);
      assert.equal(selection.kind, kind);
      const requirement = required(selection.requirements[0]);
      selection.selections = { [requirement.id]: choices.map(card =>
        required(requirement.candidates.find(candidate => candidate.cardRef === card)).key) };
      await game.finishTargetSelection();
    }
    assert.equal((await activation).success, true);
    assert.equal(positions, 1);
  } else if (mode === "executor") {
    const session = new MainPhaseSession(owner, runtime, async () => {});
    assert.equal(await session.execute(action, session.capture()), true);
    assert.equal(session.counts.accepted, 1);
  } else {
    const actionContext = mode === "planned" ? action.activationContext?.actionContext
      : mode === "destination" ? { fusionPreferences: { preferredIds: [122] } }
      : mode === "defense" ? { fusionPositions: { byId: { 121: "defense" as const } } } : {};
    assert.equal((await game.tryActivateSpell(source, owner.hand.indexOf(source), null, { owner, actionContext })).success, true);
  }
  const fusion = required(owner.field.find(card => card.id === (mode === "destination" ? 122 : 121)));
  const used = owner.graveyard.filter(card => card.cardKind === "monster");
  assert.deepEqual(used.map(card => card.id), mode === "twins" ? [111,111]
    : mode === "planned" || mode === "executor" || mode === "human" || mode === "human-retry" || mode === "unique" ? [111,104] : [111,116]);
  assert.equal(new Set(used.map(card => card.duelCardId)).size, 2);
  assert.equal(fusion.position, mode === "defense" || mode === "human" || mode === "human-retry" ? "defense" : "attack");
  const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(game.exportReplay())));
  return { game, replay, fusion, used };
}

for (const seat of ["player", "bot"] as const) {
  for (const mode of ["executor", "planned", "default", "defense", "twins", "human", "destination", "unique", "human-retry"] as const) {
    test(`${seat} ${mode} fusion records exact choices and replays in a fresh process`, async t => {
      const { game, replay, fusion, used } = await recordFusion(t, seat, mode);
      assert.deepEqual(replay.commands.map(command => command.type), ["set_phase", "activate_card"]);
      assert.deepEqual(replay.decisions.map(decision => decision.kind),
        ["field_placement", "fusion_select", ...(mode === "unique" ? [] : mode === "human-retry" ? ["fusion_materials", "fusion_materials"] : ["fusion_materials"]), "choice", "field_placement"]);
      assert.deepEqual(replay.decisions.find(decision => decision.kind === "fusion_select")?.value,
        { selections: { fusion_choice: [{ duelCardId: fusion.duelCardId, cardId: fusion.id, effectId: null, candidateKey: null, key: null }] } });
      if (mode !== "unique") assert.deepEqual([...replay.decisions].reverse().find(decision => decision.kind === "fusion_materials")?.value,
        { selections: { materials: used.map(card => ({ duelCardId: card.duelCardId, cardId: card.id, effectId: null, candidateKey: null, key: null })) } });
      const child = spawnSync(process.execPath, ["--import=tsx", "--import=./scripts/register_node_asset_loader.ts",
        "test/helpers/fusionReplayPlayback.ts"], { input: JSON.stringify(replay), encoding: "utf8", timeout: 30000 });
      assert.equal(child.status, 0, child.stderr || child.stdout);
      const output = required(child.stdout.split("\n").find(line => line.startsWith("FUSION_REPLAY_RESULT ")));
      const result = JSON.parse(output.slice("FUSION_REPLAY_RESULT ".length));
      assert.deepEqual(result.snapshot, createCanonicalStateSnapshot(game));
      assert.equal(result.cursor, replay.decisions.length);
      assert.equal(result.finalStateHash, replay.result?.finalStateHash);
    });
  }
}

for (const mutation of ["unavailable", "duplicate", "wrong-definition", "position"] as const) {
  test(`fusion playback rejects ${mutation} recorded choices`, async t => {
    const { replay } = await recordFusion(t, "bot", "planned");
    const materials = required(replay.decisions.find(decision => decision.kind === "fusion_materials"));
    assert.ok("selections" in materials.value);
    const selected = required(materials.value.selections.materials);
    const first = required(selected[0]);
    assert.ok("duelCardId" in first);
    if (mutation === "unavailable") first.duelCardId = 999999;
    if (mutation === "duplicate") selected[1] = { ...first };
    if (mutation === "wrong-definition") first.cardId = 3;
    if (mutation === "position") {
      const position = required(replay.decisions.find(decision => decision.kind === "choice"));
      position.value = { pass: false, candidateKey: "sideways", effectId: null };
    }
    const child = spawnSync(process.execPath, ["--import=tsx", "--import=./scripts/register_node_asset_loader.ts",
      "test/helpers/fusionReplayPlayback.ts"], { input: JSON.stringify(replay), encoding: "utf8", timeout: 30000 });
    assert.equal(child.status, 1, child.stderr || child.stdout);
    assert.match(child.stderr, mutation === "duplicate" ? /repeats a card identity/
      : mutation === "position" ? /no longer legal/ : /identity is no longer available/);
    assert.doesNotMatch(child.stderr, /Playback recomputed|Playback opened/);
  });
}

for (const seat of ["player", "bot"] as const) {
  for (const stage of ["fusion_select", "fusion_materials"] as const) {
    test(`${seat} human cancellation at ${stage} replays without selecting materials`, async t => {
      const game = createRuntimeGame({ captureReplay: true, randomSeed: 42, chainResponseTimeoutMs: 0 });
      t.after(() => game.dispose());
      game.disablePresentationDelays = true;
      game.waitForBoardPresentation = game.waitForPresentationDelay = game.waitForAiPresentationStep = async () => {};
      game.ui.showChainResponseModal = async () => null;
      const deck = [3,3,3,3,3,111,116,104,111,12];
      await game.startWithDecks({ exactDecks: true, preserveDeckOrder: true, initializeOnly: true,
        startAtDrawPhase: true, startingPlayer: seat, announceStartingPlayer: false,
        playerDeck: deck, botDeck: deck, playerExtraDeck: [121], botExtraDeck: [121] });
      game.phase = "main1";
      game.recordReplayCommand({ type: "set_phase", actorId: seat, payload: { phase: "main1" } });
      const owner = game[seat]; owner.controllerType = "human";
      const source = required(owner.hand.find(card => card.id === 12));
      const materialIds = owner.hand.filter(card => card.cardKind === "monster").map(card => card.duelCardId);
      const activation = game.tryActivateSpell(source, owner.hand.indexOf(source), null, { owner });
      for (const expected of stage === "fusion_select" ? ["fusion_select"] : ["fusion_select", "fusion_materials"]) {
        for (let attempt = 0; attempt < 300 && game.targetSelection?.kind !== expected; attempt++) {
          await new Promise<void>(resolve => setImmediate(resolve));
        }
        const selection = required(game.targetSelection);
        assert.equal(selection.kind, expected);
        if (expected === stage) game.cancelTargetSelection();
        else {
          const requirement = required(selection.requirements[0]);
          selection.selections = { [requirement.id]: [required(requirement.candidates[0]).key] };
          await game.finishTargetSelection();
        }
      }
      await activation;
      assert.deepEqual(owner.hand.filter(card => card.cardKind === "monster").map(card => card.duelCardId), materialIds);
      assert.equal(owner.field.length, 0);
      assert.equal(owner.extraDeck.length, 1);
      assert.equal(game.targetSelection, null);
      const replay = validateCanonicalReplay(JSON.parse(JSON.stringify(game.exportReplay())));
      assert.deepEqual(replay.decisions.find(decision => decision.kind === stage)?.value, { pass: true });
      const child = spawnSync(process.execPath, ["--import=tsx", "--import=./scripts/register_node_asset_loader.ts",
        "test/helpers/fusionReplayPlayback.ts"], { input: JSON.stringify(replay), encoding: "utf8", timeout: 30000 });
      assert.equal(child.status, 0, child.stderr || child.stdout);
    });
  }
}
