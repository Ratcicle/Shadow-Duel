import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Player from "../src/core/Player.js";
import { applySimulatedActions } from "../src/core/ai/common/simulatedActions/index.js";
import type { FastEffectContextInput } from "../src/core/contracts/chainRuntime.js";
import { normalizeZoneInput } from "../src/core/contracts/zones.js";
import {
  record,
  required,
  selectedCards,
  unsafeFixture,
} from "./helpers/fixtures.js";
import {
  runtimeCard as completeCard,
  createRuntimeGame,
} from "./helpers/game.js";
import { simulationCard, simulationState } from "./helpers/simulation.js";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import {
  handleSetFacedownDefense,
  handleSwitchDefenderPositionOnAttack,
  handleSwitchPosition,
} from "../src/core/actionHandlers/stats.js";
import { applySetFacedownDefense } from "../src/core/ai/common/simulatedActions/stats.js";
import { moveCardToZone } from "../src/core/ai/common/zones.js";
import {
  createChainHarness,
  createTestCard,
  placeCard,
} from "./chain/helpers/chainHarness.js";
import { cardDatabaseById } from "./helpers/fixtures.js";

const LEVIATHAN_ID = 27;
const EXPECTED_EN =
  '1 EARTH Tuner + 1+ non-Tuner monsters\n\nYou can discard 1 card, then target 1 face-up monster your opponent controls (Quick Effect); change it to face-down Defense Position. Monsters changed to face-down Defense Position by this effect cannot change their battle positions.\n\nIf this card is destroyed by battle or card effect: You can target up to 2 Level 3 or lower EARTH monsters in your Graveyard; Special Summon them.\n\nYou can only use each effect of "Magmatic Obsidian Leviathan" once per turn.';
const EXPECTED_PT_BR =
  "1 Regulador de TERRA + 1+ monstros não-Reguladores\n\nVocê pode descartar 1 card e, depois, escolher 1 monstro com a face para cima que seu oponente controla (Efeito Rápido); coloque-o com a face para baixo em Posição de Defesa. Monstros colocados com a face para baixo por este efeito não podem mudar suas posições de batalha.\n\nSe este card for destruído em batalha ou por efeito de card: você pode escolher até 2 monstros de TERRA de Nível 3 ou menor no seu Cemitério; Invoque-os por Invocação-Especial.\n\nVocê só pode usar cada efeito de “Leviatã de Obsidiana Magmática” uma vez por turno.";

function getLeviathan() {
  const card = cardDatabaseById.get(LEVIATHAN_ID);
  assert.ok(card, "Magmatic Obsidian Leviathan must be in the card database");
  return card;
}

test("Magmatic Obsidian Leviathan declara materiais, efeitos e limites canônicos", async () => {
  const card = getLeviathan();
  const validation = validateCardDatabase();
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);

  assert.equal(card.name, "Magmatic Obsidian Leviathan");
  assert.equal(card.description, EXPECTED_EN);
  const locale = JSON.parse(
    await readFile(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(locale.cards[String(LEVIATHAN_ID)].description, EXPECTED_PT_BR);
  assert.equal(card.monsterType, "synchro");
  assert.deepEqual(card.synchro, {
    tunerCount: 1,
    nonTunerMin: 1,
    materialFilters: { tuner: { attribute: "Earth", isTuner: true } },
  });

  const quick = required(
    required(card.effects).find(
      (effect) => effect.id === "magmatic_obsidian_leviathan_facedown_lock",
    ),
  );
  assert.equal(quick.timing, "manual");
  assert.equal(quick.speed, 2);
  assert.equal(quick.isQuickEffect, true);
  assert.deepEqual(quick.activationZones, ["field"]);
  assert.equal(quick.requireFaceup, true);
  assert.equal(quick.usagePolicy, "use");
  assert.equal(required(quick.targets)[0].intent, "cost");
  assert.equal(required(quick.activationCosts)[0].type, "move");
  assert.equal(required(quick.actions)[0].type, "set_facedown_defense");
  assert.equal(required(quick.actions)[0].lockBattlePosition, true);

  const revive = required(
    required(card.effects).find(
      (effect) => effect.id === "magmatic_obsidian_leviathan_destroyed_revive",
    ),
  );
  assert.equal(revive.event, "card_to_grave");
  assert.equal(revive.requireSelfAsDestroyed, true);
  assert.deepEqual(revive.condition, { type: "destroyed_by_battle_or_effect" });
  assert.equal(revive.usagePolicy, "use");
  assert.deepEqual(required(revive.targets)[0].count, { min: 1, max: 2 });
  assert.equal(required(revive.targets)[0].attribute, "Earth");
  assert.equal(required(revive.targets)[0].maxLevel, 3);
  assert.equal(
    required(revive.actions)[0].targetRef,
    required(revive.targets)[0].id,
  );
});

test("materiais de Sincro exigem Regulador TERRA e aceitam não-Reguladores livres", (t) => {
  const leviathan = completeCard({
    ...getLeviathan(),
    instanceId: "leviathan",
  });
  const earthTuner = completeCard({
    instanceId: "earth-tuner",
    cardKind: "monster",
    isTuner: true,
    attribute: "Earth",
    level: 3,
    isFacedown: false,
  });
  const fireTuner = completeCard({
    instanceId: "fire-tuner",
    cardKind: "monster",
    isTuner: true,
    attribute: "Fire",
    level: 3,
    isFacedown: false,
  });
  const nonTuner = completeCard({
    instanceId: "non-tuner",
    cardKind: "monster",
    isTuner: false,
    attribute: "Water",
    level: 6,
    isFacedown: false,
  });
  const player = Object.assign(new Player("player", "Material fixture"), {
    field: [earthTuner, fireTuner, nonTuner],
  });
  const game = createRuntimeGame({
    disableChains: true,
    captureReplay: false,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());

  const combos = game.getSynchroMaterialCombos(player, leviathan);
  assert.deepEqual(combos, [[earthTuner, nonTuner]]);
});

test("set_facedown_defense trava posição, expõe o status e não bloqueia limpeza ao sair", async (t) => {
  const game = createRuntimeGame({
    disableChains: true,
    captureReplay: false,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());
  const { player, bot } = game;
  const events: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const logs: unknown[][] = [];
  const target = completeCard({
    instanceId: "target",
    name: "Face-up target",
    owner: bot.id,
    cardKind: "monster",
    position: "attack",
    isFacedown: false,
  });
  const source = completeCard({ name: "Source", owner: player.id });
  bot.field.push(target);
  game.turn = bot.id;
  game.phase = "main1";
  game.turnCounter = 4;
  game.ui.log = (...args) => {
    logs.push(args);
  };
  game.emit = async (name, payload) => {
    events.push({ name, payload: record(payload) });
    return { ok: true };
  };
  game.updateBoard = async () => true;

  const changed = await handleSetFacedownDefense(
    {
      type: "set_facedown_defense",
      targetRef: "target",
      lockBattlePosition: true,
    },
    { player, opponent: bot, source },
    { target: [target] },
    unsafeFixture<Parameters<typeof handleSetFacedownDefense>[3]>(
      { game },
      "Direct handler fixture supplies the game capability while unused engine methods remain absent.",
    ),
  );
  assert.equal(changed, true);
  assert.equal(target.position, "defense");
  assert.equal(target.isFacedown, true);
  assert.equal(target.battlePositionLocked, true);
  assert.equal(events[0].name, "position_change");
  assert.equal(events[0].payload.wasSetFacedown, true);
  assert.equal(events[0].payload.battlePositionLocked, true);
  assert.ok(logs.length > 0);

  assert.equal(game.canChangePosition(target), false);
  assert.equal(game.canFlipSummon(target), false);
  assert.equal(
    await handleSwitchPosition(
      { type: "switch_position", targetRef: "target" },
      { player, opponent: bot, source },
      { target: [target] },
      unsafeFixture<Parameters<typeof handleSwitchPosition>[3]>(
        { game },
        "Direct handler fixture supplies the game capability while unused engine methods remain absent.",
      ),
    ),
    false,
  );
  assert.equal(
    await handleSwitchDefenderPositionOnAttack(
      { type: "switch_defender_position_on_attack" },
      { player, opponent: bot, defender: target },
      {},
      unsafeFixture<Parameters<typeof handleSwitchDefenderPositionOnAttack>[3]>(
        { game },
        "Direct handler fixture supplies the game capability while unused engine methods remain absent.",
      ),
    ),
    false,
  );
});

test("simulação aplica e limpa a trava de posição com o mesmo contrato", () => {
  const target = simulationCard({
    instanceId: "sim-target",
    cardKind: "monster",
    position: "attack",
    isFacedown: false,
  });
  const state = simulationState({
    player: { id: "player", field: [] },
    bot: { id: "bot", field: [target], graveyard: [] },
  });
  applySetFacedownDefense({
    action: {
      type: "set_facedown_defense",
      targetRef: "target",
      lockBattlePosition: true,
    },
    targets: [target],
    state,
    selfId: "bot",
    self: state.bot,
    opponent: state.player,
    applySimulatedActions,
    options: {},
  });
  assert.equal(target.isFacedown, true);
  assert.equal(target.position, "defense");
  assert.equal(target.battlePositionLocked, true);

  moveCardToZone(state.bot, target, "graveyard");
  assert.equal(target.battlePositionLocked, false);
});

test("ativação rápida usa a transação canônica: custo antes de alvo e elo", async () => {
  let harness: ReturnType<typeof createChainHarness>;
  harness = createChainHarness({
    async onActions(actions, _ctx, targets) {
      for (const action of actions) {
        if (action.type !== "move" || !action.targetRef) continue;
        const [cost] = selectedCards(targets, required(action.targetRef));
        if (!cost) continue;
        await harness.game.moveCard(
          cost,
          harness.player,
          normalizeZoneInput(action.to),
          {
            fromZone: action.fromZone
              ? normalizeZoneInput(action.fromZone)
              : undefined,
            contextLabel: action.contextLabel,
          },
        );
      }
    },
  });
  const { chain, player, bot } = harness;
  const leviathan = createTestCard({
    ...structuredClone(getLeviathan()),
    instanceId: "leviathan-source",
  });
  const discard = createTestCard({ instanceId: "discard", name: "Discard" });
  const target = createTestCard({
    instanceId: "opponent-target",
    name: "Opponent target",
    isFacedown: false,
  });
  placeCard(player, "field", leviathan);
  placeCard(player, "hand", discard);
  placeCard(bot, "field", target);

  const context: FastEffectContextInput = {
    type: "effect_activation",
    event: "effect_activation",
    player: bot,
    triggerPlayer: bot,
    openState: true,
    legalWindow: true,
  };
  const candidate = chain
    .getActivatableCardsInChain(player, context)
    .find(
      (entry) => entry.effectId === "magmatic_obsidian_leviathan_facedown_lock",
    );
  assert.ok(candidate);

  const result = await chain.prepareChainResponse(candidate, player, context);
  assert.ok(result.success === true);
  assert.equal(player.graveyard.includes(discard), true);
  assert.deepEqual(required(result.preparedActivation).costSelections, {
    magmatic_obsidian_leviathan_discard_cost: [discard],
  });
  assert.deepEqual(required(result.preparedActivation).targetSelections, {
    magmatic_obsidian_leviathan_facedown_target: [target],
  });

  const link = required(chain.addToChain(required(result.preparedActivation)));
  assert.equal(link.spellSpeed, 2);
  assert.deepEqual(link.declaredTargets, [
    {
      targetId: "magmatic_obsidian_leviathan_facedown_target",
      cards: [target],
    },
  ]);
  assert.equal(
    selectedCards(
      link.costSelections,
      "magmatic_obsidian_leviathan_discard_cost",
    )[0],
    discard,
  );
});

test("o Trigger de destruição Invoca até dois monstros sequencialmente", async (t) => {
  const game = createRuntimeGame({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  game.disablePresentationDelays = true;
  game.player.controllerType = "ai";
  t.after(() => game.dispose());

  const leviathan = new Card(structuredClone(getLeviathan()), game.player.id);
  leviathan.owner = game.player.id;
  leviathan.controller = game.player.id;
  const revived = [1, 2].map((level, index) => {
    const card = new Card(
      {
        id: 99600 + index,
        name: `Sequential EARTH ${index + 1}`,
        cardKind: "monster",
        attribute: "Earth",
        level,
        atk: 500,
        def: 500,
      },
      game.player.id,
    );
    card.owner = game.player.id;
    card.controller = game.player.id;
    return card;
  });
  game.player.graveyard.push(leviathan, ...revived);
  const summonOrder: Array<
    import("../src/core/contracts/events.js").EventCard
  > = [];
  game.on("after_summon", ({ card }) => {
    if (revived.some((candidate) => candidate === card)) summonOrder.push(card);
  });

  const effect = required(
    required(leviathan.effects).find(
      ({ id }) => id === "magmatic_obsidian_leviathan_destroyed_revive",
    ),
  );
  const action = required(effect.actions)[0];
  assert.ok(action.type === "special_summon_from_zone");
  const result = await game.effectEngine.applyActions(
    [{ ...action, position: "attack" }],
    {
      source: leviathan,
      player: game.player,
      opponent: game.bot,
      effect,
    },
    { magmatic_obsidian_leviathan_revive_targets: revived },
  );

  assert.ok(result.success === true);
  assert.deepEqual(game.player.field, revived);
  assert.deepEqual(summonOrder, revived);
});

test("o status de posição é serializado e removido quando o monstro sai do campo", async (t) => {
  const game = createRuntimeGame({
    captureReplay: false,
    disableChains: true,
    laboratoryMode: true,
  });
  t.after(() => game.dispose());
  const card = new Card(
    {
      id: 9999,
      name: "Locked target",
      cardKind: "monster",
      atk: 1000,
      def: 1000,
    },
    game.player.id,
  );
  card.owner = game.player.id;
  card.controller = game.player.id;
  game.player.field.push(card);
  card.battlePositionLocked = true;

  assert.equal(
    required(game.getPublicState(game.player.id).players.self.field[0]).status
      .battlePositionLocked,
    true,
  );

  const moved = await game.moveCard(card, game.player, "graveyard", {
    fromZone: "field",
    skipAnimation: true,
    awaitEvents: true,
  });
  assert.ok(moved.success === true);
  assert.equal(game.player.graveyard.includes(card), true);
  assert.equal(card.battlePositionLocked, false);
});
