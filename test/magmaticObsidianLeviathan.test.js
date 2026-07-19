import assert from "node:assert/strict";
import test from "node:test";

import Card from "../src/core/Card.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import { cardDatabaseById } from "../src/data/cards.js";
import Game from "../src/core/Game.js";
import {
  handleSetFacedownDefense,
  handleSwitchDefenderPositionOnAttack,
  handleSwitchPosition,
} from "../src/core/actionHandlers/stats.js";
import { applySetFacedownDefense } from "../src/core/ai/common/simulatedActions/stats.js";
import { moveCardToZone } from "../src/core/ai/common/zones.js";
import {
  canChangePosition,
  canFlipSummon,
} from "../src/core/game/summon/position.js";
import {
  canUseAsSynchroMaterial,
  getSynchroMaterialCombos,
} from "../src/core/game/summon/synchro.js";
import {
  createChainHarness,
  createTestCard,
  placeCard,
} from "./chain/helpers/chainHarness.js";

const LEVIATHAN_ID = 27;

function getLeviathan() {
  const card = cardDatabaseById.get(LEVIATHAN_ID);
  assert.ok(card, "Magmatic Obsidian Leviathan must be in the card database");
  return card;
}

test("Magmatic Obsidian Leviathan declara materiais, efeitos e limites canônicos", () => {
  const card = getLeviathan();
  const validation = validateCardDatabase();
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.warnings.length, 0);

  assert.equal(card.name, "Magmatic Obsidian Leviathan");
  assert.equal(card.monsterType, "synchro");
  assert.deepEqual(
    card.synchro,
    {
      tunerCount: 1,
      nonTunerMin: 1,
      materialFilters: { tuner: { attribute: "Earth", isTuner: true } },
    },
  );

  const quick = card.effects.find(
    (effect) => effect.id === "magmatic_obsidian_leviathan_facedown_lock",
  );
  assert.equal(quick.timing, "manual");
  assert.equal(quick.speed, 2);
  assert.equal(quick.isQuickEffect, true);
  assert.deepEqual(quick.activationZones, ["field"]);
  assert.equal(quick.requireFaceup, true);
  assert.equal(quick.usagePolicy, "use");
  assert.equal(quick.targets[0].intent, "cost");
  assert.equal(quick.activationCosts[0].type, "move");
  assert.equal(quick.actions[0].type, "set_facedown_defense");
  assert.equal(quick.actions[0].lockBattlePosition, true);

  const revive = card.effects.find(
    (effect) => effect.id === "magmatic_obsidian_leviathan_destroyed_revive",
  );
  assert.equal(revive.event, "card_to_grave");
  assert.equal(revive.requireSelfAsDestroyed, true);
  assert.deepEqual(revive.condition, { type: "destroyed_by_battle_or_effect" });
  assert.equal(revive.usagePolicy, "use");
  assert.deepEqual(revive.targets[0].count, { min: 1, max: 2 });
  assert.equal(revive.targets[0].attribute, "Earth");
  assert.equal(revive.targets[0].maxLevel, 3);
  assert.equal(revive.actions[0].targetRef, revive.targets[0].id);
});

test("materiais de Sincro exigem Regulador TERRA e aceitam não-Reguladores livres", () => {
  const leviathan = { ...getLeviathan(), instanceId: "leviathan" };
  const earthTuner = {
    instanceId: "earth-tuner",
    cardKind: "monster",
    isTuner: true,
    attribute: "Earth",
    level: 3,
    isFacedown: false,
  };
  const fireTuner = {
    instanceId: "fire-tuner",
    cardKind: "monster",
    isTuner: true,
    attribute: "Fire",
    level: 3,
    isFacedown: false,
  };
  const nonTuner = {
    instanceId: "non-tuner",
    cardKind: "monster",
    isTuner: false,
    attribute: "Water",
    level: 6,
    isFacedown: false,
  };
  const player = { field: [earthTuner, fireTuner, nonTuner] };
  const game = { canUseAsSynchroMaterial };

  const combos = getSynchroMaterialCombos.call(game, player, leviathan);
  assert.deepEqual(combos, [[earthTuner, nonTuner]]);
});

test("set_facedown_defense trava posição, expõe o status e não bloqueia limpeza ao sair", async () => {
  const player = { id: "player", field: [] };
  const bot = { id: "bot", field: [] };
  const events = [];
  const logs = [];
  const target = {
    instanceId: "target",
    name: "Face-up target",
    owner: bot.id,
    cardKind: "monster",
    position: "attack",
    isFacedown: false,
  };
  const source = { name: "Source", owner: player.id };
  bot.field.push(target);
  const game = {
    player,
    bot,
    turn: bot.id,
    phase: "main1",
    turnCounter: 4,
    ui: { log: (...args) => logs.push(args) },
    effectEngine: { clearTargetingCache() {} },
    getOpponent(owner) {
      return owner === player ? bot : player;
    },
    async emit(name, payload) {
      events.push({ name, payload });
      return { ok: true };
    },
    updateBoard() {},
  };

  const changed = await handleSetFacedownDefense(
    {
      type: "set_facedown_defense",
      targetRef: "target",
      lockBattlePosition: true,
    },
    { player, opponent: bot, source },
    { target: [target] },
    { game },
  );
  assert.equal(changed, true);
  assert.equal(target.position, "defense");
  assert.equal(target.isFacedown, true);
  assert.equal(target.battlePositionLocked, true);
  assert.equal(events[0].name, "position_change");
  assert.equal(events[0].payload.wasSetFacedown, true);
  assert.equal(events[0].payload.battlePositionLocked, true);
  assert.ok(logs.length > 0);

  assert.equal(canChangePosition.call(game, target), false);
  assert.equal(canFlipSummon.call(game, target), false);
  assert.equal(
    await handleSwitchPosition(
      { type: "switch_position", targetRef: "target" },
      { player, opponent: bot, source },
      { target: [target] },
      { game },
    ),
    false,
  );
  assert.equal(
    await handleSwitchDefenderPositionOnAttack(
      { type: "switch_defender_position_on_attack" },
      { player, opponent: bot, defender: target },
      {},
      { game },
    ),
    false,
  );
});

test("simulação aplica e limpa a trava de posição com o mesmo contrato", () => {
  const target = {
    instanceId: "sim-target",
    cardKind: "monster",
    position: "attack",
    isFacedown: false,
  };
  const state = {
    player: { id: "player", field: [] },
    bot: { id: "bot", field: [target], graveyard: [] },
  };
  applySetFacedownDefense({
    action: { type: "set_facedown_defense", lockBattlePosition: true },
    targets: [target],
    state,
    options: {},
  });
  assert.equal(target.isFacedown, true);
  assert.equal(target.position, "defense");
  assert.equal(target.battlePositionLocked, true);

  moveCardToZone(state.bot, target, "graveyard");
  assert.equal(target.battlePositionLocked, false);
});

test("ativação rápida usa a transação canônica: custo antes de alvo e elo", async () => {
  let harness;
  harness = createChainHarness({
    async onActions(actions, _ctx, targets) {
      for (const action of actions) {
        if (action.type !== "move" || !action.targetRef) continue;
        const [cost] = targets[action.targetRef] || [];
        if (!cost) continue;
        await harness.game.moveCard(cost, harness.player, action.to, {
          fromZone: action.fromZone,
          contextLabel: action.contextLabel,
        });
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

  const context = {
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
      (entry) =>
        entry.effectId === "magmatic_obsidian_leviathan_facedown_lock",
    );
  assert.ok(candidate);

  const result = await chain.prepareChainResponse(candidate, player, context);
  assert.equal(result.success, true);
  assert.equal(player.graveyard.includes(discard), true);
  assert.deepEqual(result.preparedActivation.costSelections, {
    magmatic_obsidian_leviathan_discard_cost: [discard],
  });
  assert.deepEqual(result.preparedActivation.targetSelections, {
    magmatic_obsidian_leviathan_facedown_target: [target],
  });

  const link = chain.addToChain(result.preparedActivation);
  assert.equal(link.spellSpeed, 2);
  assert.deepEqual(link.declaredTargets, [
    {
      targetId: "magmatic_obsidian_leviathan_facedown_target",
      cards: [target],
    },
  ]);
  assert.equal(link.costSelections.magmatic_obsidian_leviathan_discard_cost[0], discard);
});

test("o status de posição é serializado e removido quando o monstro sai do campo", async (t) => {
  const game = new Game({
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
    game.getPublicState(game.player.id).players.self.field[0].status
      .battlePositionLocked,
    true,
  );

  const moved = await game.moveCard(card, game.player, "graveyard", {
    fromZone: "field",
    skipAnimation: true,
    awaitEvents: true,
  });
  assert.equal(moved.success, true);
  assert.equal(game.player.graveyard.includes(card), true);
  assert.equal(card.battlePositionLocked, false);
});
