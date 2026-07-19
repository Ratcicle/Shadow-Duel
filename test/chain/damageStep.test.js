import assert from "node:assert/strict";
import test from "node:test";

import Card from "../../src/core/Card.js";
import Game from "../../src/core/Game.js";
import { cardDatabaseByName } from "../../src/data/cards.js";
import {
  DAMAGE_STEP_ACTIVATION_CATEGORIES,
  DAMAGE_STEP_TIMINGS,
  canActivateDuringDamageStep,
} from "../../src/core/game/spellTrap/quickSpellRules.js";
import {
  cleanupDamageStepTransaction,
  clearDamageCalculationBuffs,
  clearEndOfDamageStepBuffs,
  createDamageStepTransaction,
  executeDamageStepTransaction,
  getDamageStepState,
} from "../../src/core/game/combat/damageStep.js";
import { canStartAction } from "../../src/core/game/actions/guard.js";
import { selectCandidates } from "../../src/core/effects/targeting/selection.js";
import { isBattleDestructionProtected } from "../../src/core/game/zones/destruction.js";
import { resetDuelState } from "../../src/core/game/state/duelReset.js";
import {
  createChainHarness,
  createTestCard,
  placeCard,
} from "./helpers/chainHarness.js";

// Official baseline: Damage Step Rules and the official Rulebook.
// https://www.yugioh-card.com/eu/play/damage-step-rules/
// https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf

const FIVE_TIMINGS = [
  DAMAGE_STEP_TIMINGS.START,
  DAMAGE_STEP_TIMINGS.BEFORE_CALCULATION,
  DAMAGE_STEP_TIMINGS.CALCULATION,
  DAMAGE_STEP_TIMINGS.AFTER_CALCULATION,
  DAMAGE_STEP_TIMINGS.END,
];

function createDamageHarness(options = {}) {
  const harness = createChainHarness({
    phase: "battle",
    playerControllerType: "ai",
    botControllerType: "ai",
  });
  const { game, player, bot, trace } = harness;
  game.battleStep = "battle";
  game.nextDamageStepId = 1;
  game.activeDamageStepTransaction = null;
  game.lastDamageStepTransaction = null;
  game.damageStepProcedureDepth = 0;
  game.damageCalculationTempBuffs = [];
  game.endOfDamageStepTempBuffs = [];
  game.createDamageStepTransaction = createDamageStepTransaction.bind(game);
  game.executeDamageStepTransaction = executeDamageStepTransaction.bind(game);
  game.getDamageStepState = getDamageStepState.bind(game);
  game.cleanupDamageStepTransaction = cleanupDamageStepTransaction.bind(game);
  game.clearDamageCalculationBuffs = clearDamageCalculationBuffs.bind(game);
  game.clearEndOfDamageStepBuffs = clearEndOfDamageStepBuffs.bind(game);
  game.waitForPresentationDelay = async () => {};
  game.effectEngine.clearTargetingCache = () => {};
  game.canDestroyByBattle = () => true;
  game.isBattleDestructionProtected =
    isBattleDestructionProtected.bind(game);
  game.markAttackUsed = (attacker, target) => {
    attacker.attacksUsedThisTurn = Number(attacker.attacksUsedThisTurn || 0) + 1;
    trace.actions.push({ type: "attack_used", attacker, target });
  };
  game.inflictDamage = (owner, amount) => {
    owner.lp = Math.max(0, Number(owner.lp || 0) - Number(amount || 0));
  };
  game.checkAndOfferTraps = async (eventName, payload) => {
    trace.responses.push({ eventName, payload });
    if (typeof options.onWindow === "function") {
      const result = await options.onWindow(eventName, payload, harness);
      if (result !== undefined) return result;
    }
    return { ok: true, success: true, chainBuilt: false };
  };
  game.destroyCard = async (card, destroyOptions = {}) => {
    const owner = card.owner === player.id ? player : bot;
    if (typeof options.onDestroy === "function") {
      await options.onDestroy(card, destroyOptions, harness);
    }
    trace.actions.push({
      type: "destroy",
      card,
      timing: game.activeDamageStepTransaction?.timing || null,
      options: destroyOptions,
    });
    const moveResult = await game.moveCard(card, owner, "graveyard", {
      ...destroyOptions,
      wasDestroyed: true,
    });
    return { destroyed: moveResult?.success !== false };
  };
  return harness;
}

function monster(name, owner, overrides = {}) {
  return createTestCard({
    instanceId: `${owner}-${name}`,
    name,
    owner,
    cardKind: "monster",
    atk: 1800,
    def: 1000,
    position: "attack",
    ...overrides,
  });
}

function timingTrace(trace) {
  return trace.events
    .filter((entry) => entry.channel === "notify" && entry.eventName === "damage_step_timing")
    .map((entry) => entry.payload.timing);
}

test("[CS-10] combate percorre as cinco subetapas do Damage Step", async () => {
  const { game, player, bot, trace } = createDamageHarness();
  const attacker = placeCard(player, "field", monster("Attacker", player.id));
  const defender = placeCard(
    bot,
    "field",
    monster("Defender", bot.id, { atk: 1200 }),
  );

  const transaction = game.createDamageStepTransaction({ attacker, defender });
  const result = await game.executeDamageStepTransaction(transaction);

  assert.equal(result.ok, true);
  assert.deepEqual(timingTrace(trace), FIVE_TIMINGS);
  assert.equal(game.getDamageStepState().active, false);
  assert.equal(game.getDamageStepState().last.status, "completed");
});

test("[CS-10] categorias de ativação são filtradas pela subetapa exata", () => {
  const statCard = createTestCard({ cardKind: "spell", subtype: "quick" });
  const statEffect = {
    id: "raise_atk",
    actions: [{ type: "buff_stats_temp", atkBoost: 500 }],
  };
  const checks = FIVE_TIMINGS.map((damageStepTiming) =>
    canActivateDuringDamageStep(statEffect, statCard, {
      isDamageStep: true,
      damageStepTiming,
    }),
  );
  assert.deepEqual(checks.map((entry) => entry.ok), [true, true, false, false, false]);
  assert.ok(
    checks.every(
      (entry) =>
        entry.category === DAMAGE_STEP_ACTIVATION_CATEGORIES.DIRECT_ATK_DEF,
    ),
  );

  const explicit = canActivateDuringDamageStep(
    { damageStepTimings: [DAMAGE_STEP_TIMINGS.AFTER_CALCULATION], actions: [] },
    createTestCard({ cardKind: "monster" }),
    {
      isDamageStep: true,
      damageStepTiming: DAMAGE_STEP_TIMINGS.AFTER_CALCULATION,
    },
  );
  assert.equal(explicit.ok, true);
  assert.equal(explicit.category, DAMAGE_STEP_ACTIVATION_CATEGORIES.EXPLICIT_TIMING);

  const generic = canActivateDuringDamageStep(
    { isQuickEffect: true, actions: [{ type: "draw", amount: 1 }] },
    createTestCard({ cardKind: "monster" }),
    { isDamageStep: true, damageStepTiming: DAMAGE_STEP_TIMINGS.START },
  );
  assert.equal(generic.ok, false);
  assert.equal(generic.code, "DAMAGE_STEP_RESTRICTED");
  assert.equal(generic.category, DAMAGE_STEP_ACTIVATION_CATEGORIES.GENERIC_FAST_EFFECT);
  assert.doesNotThrow(() => JSON.stringify(generic));
});

test("[CS-10] ataque direto percorre o mesmo pipeline de Damage Step", async () => {
  const { game, player, bot, trace } = createDamageHarness();
  const attacker = placeCard(
    player,
    "field",
    monster("Direct Attacker", player.id, { atk: 2100 }),
  );

  const transaction = game.createDamageStepTransaction({
    attacker,
    defenderOwner: bot,
  });
  const result = await game.executeDamageStepTransaction(transaction);

  assert.equal(result.ok, true);
  assert.equal(result.damageDealt, 2100);
  assert.equal(bot.lp, 5900);
  assert.deepEqual(timingTrace(trace), FIVE_TIMINGS);
  assert.equal(trace.moves.length, 0);
  assert.equal(game.getDamageStepState().last.directAttack, true);
  assert.equal(game.getDamageStepState().last.defender, null);
});

test("[CS-10] Flip, dano, destruição e envio ao Cemitério ocorrem nas etapas corretas", async () => {
  const { game, player, bot, trace } = createDamageHarness();
  const observations = [];
  const baseEmit = game.emit.bind(game);
  game.emit = async (eventName, payload, emitOptions) => {
    observations.push({
      eventName,
      timing: payload?.damageStepTiming || null,
      botLp: bot.lp,
      defenderOnField: bot.field.includes(defender),
    });
    return await baseEmit(eventName, payload, emitOptions);
  };
  const attacker = placeCard(
    player,
    "field",
    monster("Piercing Attacker", player.id, { atk: 1800, piercing: true }),
  );
  const defender = placeCard(
    bot,
    "field",
    monster("Set Defender", bot.id, {
      atk: 500,
      def: 1000,
      position: "defense",
      isFacedown: true,
    }),
  );

  const transaction = game.createDamageStepTransaction({ attacker, defender });
  const result = await game.executeDamageStepTransaction(transaction);

  const flipped = observations.find((entry) => entry.eventName === "card_flipped");
  const damaged = observations.find(
    (entry) => entry.eventName === "battle_damage_inflicted",
  );
  const completed = observations.find(
    (entry) => entry.eventName === "battle_completed",
  );
  const toGrave = observations.find((entry) => entry.eventName === "card_to_grave");
  assert.equal(flipped.timing, DAMAGE_STEP_TIMINGS.AFTER_CALCULATION);
  assert.equal(flipped.botLp, 7200);
  assert.equal(flipped.defenderOnField, true);
  assert.equal(damaged.timing, DAMAGE_STEP_TIMINGS.AFTER_CALCULATION);
  assert.equal(damaged.defenderOnField, true);
  assert.equal(completed.timing, DAMAGE_STEP_TIMINGS.AFTER_CALCULATION);
  assert.equal(toGrave.timing, DAMAGE_STEP_TIMINGS.END);
  assert.equal(result.targetDestroyed, true);
  assert.equal(bot.field.includes(defender), false);
  assert.equal(bot.graveyard.includes(defender), true);
  assert.equal(defender.isFacedown, false);
  assert.equal(
    trace.actions.find((entry) => entry.type === "destroy").timing,
    DAMAGE_STEP_TIMINGS.END,
  );
});

test("a revelação obrigatória no Damage Step preserva a trava de posição", async () => {
  const { game, player, bot } = createDamageHarness();
  const attacker = placeCard(
    player,
    "field",
    monster("Locked reveal attacker", player.id, { atk: 1800 }),
  );
  const defender = placeCard(
    bot,
    "field",
    monster("Locked reveal defender", bot.id, {
      def: 3000,
      position: "defense",
      isFacedown: true,
      battlePositionLocked: true,
    }),
  );

  const result = await game.executeDamageStepTransaction(
    game.createDamageStepTransaction({ attacker, defender }),
  );

  assert.equal(result.ok, true);
  assert.equal(defender.isFacedown, false);
  assert.equal(defender.position, "defense");
  assert.equal(defender.battlePositionLocked, true);
});

test("ATK zero contra ATK zero não determina destruição", async () => {
  const { game, player, bot } = createDamageHarness();
  const attacker = placeCard(
    player,
    "field",
    monster("Zero A", player.id, { atk: 0 }),
  );
  const defender = placeCard(
    bot,
    "field",
    monster("Zero B", bot.id, { atk: 0 }),
  );

  const result = await game.executeDamageStepTransaction(
    game.createDamageStepTransaction({ attacker, defender }),
  );

  assert.equal(result.targetDestroyed, false);
  assert.equal(result.attackerDestroyed, false);
  assert.ok(player.field.includes(attacker));
  assert.ok(bot.field.includes(defender));
});

test("proteção existente no cálculo impede a determinação de destruição", async () => {
  const { game, player, bot } = createDamageHarness();
  const attacker = placeCard(
    player,
    "field",
    monster("Protection Check", player.id, { atk: 2200 }),
  );
  const defender = placeCard(
    bot,
    "field",
    monster("Protected", bot.id, {
      atk: 1000,
      protectionEffects: [
        { type: "battle_destruction", duration: "while_faceup" },
      ],
    }),
  );

  const result = await game.executeDamageStepTransaction(
    game.createDamageStepTransaction({ attacker, defender }),
  );

  assert.equal(result.targetDestroyed, false);
  assert.ok(bot.field.includes(defender));
  assert.equal(bot.graveyard.includes(defender), false);
});

test("destruição mútua move cartas sequencialmente no mesmo grupo atômico", async () => {
  const { game, player, bot, trace } = createDamageHarness();
  const attacker = placeCard(
    player,
    "field",
    monster("Equal A", player.id, { atk: 1500 }),
  );
  const defender = placeCard(
    bot,
    "field",
    monster("Equal B", bot.id, { atk: 1500 }),
  );

  const result = await game.executeDamageStepTransaction(
    game.createDamageStepTransaction({ attacker, defender }),
  );
  const destroys = trace.actions.filter((entry) => entry.type === "destroy");

  assert.equal(result.attackerDestroyed, true);
  assert.equal(result.targetDestroyed, true);
  assert.deepEqual(trace.moves.map((entry) => entry.card), [attacker, defender]);
  assert.equal(destroys.length, 2);
  assert.equal(destroys[0].options.atomicGroupId, destroys[1].options.atomicGroupId);
});

test("erro durante a destruição final conclui com segurança os movimentos pendentes", async () => {
  let failedOnce = false;
  const { game, player, bot, trace } = createDamageHarness({
    onDestroy(card) {
      if (!failedOnce && card.name === "Safe Finalization B") {
        failedOnce = true;
        throw new Error("forced_destruction_error");
      }
    },
  });
  const attacker = placeCard(
    player,
    "field",
    monster("Safe Finalization A", player.id, { atk: 1600 }),
  );
  const defender = placeCard(
    bot,
    "field",
    monster("Safe Finalization B", bot.id, { atk: 1600 }),
  );

  const result = await game.executeDamageStepTransaction(
    game.createDamageStepTransaction({ attacker, defender }),
  );

  assert.equal(result.ok, false);
  assert.match(result.reason, /forced_destruction_error/);
  assert.deepEqual(trace.moves.map((entry) => entry.card), [attacker, defender]);
  assert.ok(player.graveyard.includes(attacker));
  assert.ok(bot.graveyard.includes(defender));
  assert.equal(game.getDamageStepState().active, false);
});

test("Counter Trap e negação de ativação permanecem legais no timing exato", () => {
  const counterCard = createTestCard({ cardKind: "trap", subtype: "counter" });
  for (const timing of FIVE_TIMINGS) {
    const legality = canActivateDuringDamageStep(
      { actions: [{ type: "draw", amount: 1 }] },
      counterCard,
      { isDamageStep: true, damageStepTiming: timing },
    );
    assert.equal(legality.ok, true);
    assert.equal(legality.category, DAMAGE_STEP_ACTIVATION_CATEGORIES.COUNTER_TRAP);
  }

  const negation = canActivateDuringDamageStep(
    { actions: [{ type: "negate_activation" }] },
    createTestCard({ cardKind: "monster" }),
    {
      isDamageStep: true,
      damageStepTiming: DAMAGE_STEP_TIMINGS.CALCULATION,
      responseContextType: "effect_activation",
    },
  );
  assert.equal(negation.ok, true);
  assert.equal(negation.category, DAMAGE_STEP_ACTIVATION_CATEGORIES.ACTIVATION_NEGATION);
});

test("IDs de Damage Step são monotônicos e isolados por Game", () => {
  const first = createDamageHarness();
  const second = createDamageHarness();
  const firstAttacker = placeCard(
    first.player,
    "field",
    monster("First", first.player.id),
  );
  const secondAttacker = placeCard(
    second.player,
    "field",
    monster("Second", second.player.id),
  );
  const firstTransaction = first.game.createDamageStepTransaction({
    attacker: firstAttacker,
    defenderOwner: first.bot,
  });
  first.game.cleanupDamageStepTransaction("test");
  const nextTransaction = first.game.createDamageStepTransaction({
    attacker: firstAttacker,
    defenderOwner: first.bot,
  });
  const isolatedTransaction = second.game.createDamageStepTransaction({
    attacker: secondAttacker,
    defenderOwner: second.bot,
  });

  assert.deepEqual(
    [firstTransaction.damageStepId, nextTransaction.damageStepId],
    [1, 2],
  );
  assert.equal(isolatedTransaction.damageStepId, 1);
});

test("reset limpa Damage Step e seleção sem reutilizar ID", () => {
  const { game, player, bot } = createDamageHarness();
  const attacker = placeCard(player, "field", monster("Reset A", player.id));
  const first = game.createDamageStepTransaction({
    attacker,
    defenderOwner: bot,
  });
  game.targetSelection = { active: true };
  game.selectionState = "selecting";

  resetDuelState.call(game, "damage_step_reset", {
    turn: "player",
    phase: "battle",
    turnCounter: 0,
  });
  const next = game.createDamageStepTransaction({
    attacker,
    defenderOwner: bot,
  });

  assert.equal(first.status, "cancelled");
  assert.equal(game.targetSelection, null);
  assert.equal(game.selectionState, "idle");
  assert.equal(next.damageStepId, 2);
});

test("estado público do Damage Step é serializável e oculta defensor setado", () => {
  const { game, player, bot } = createDamageHarness();
  const attacker = placeCard(player, "field", monster("Public A", player.id));
  const defender = placeCard(
    bot,
    "field",
    monster("Secret Defender", bot.id, {
      position: "defense",
      isFacedown: true,
    }),
  );
  game.createDamageStepTransaction({ attacker, defender });

  const publicState = game.getPublicState(player.id);
  assert.equal(publicState.combat.damageStep.active, true);
  assert.equal(publicState.combat.damageStep.transaction.defender.name, null);
  assert.doesNotThrow(() => JSON.stringify(publicState.combat));
});

test("ataque interrompido antes do cálculo não publica battle_completed", async () => {
  let stopped = false;
  const { game, player, bot, trace } = createDamageHarness({
    onWindow(_eventName, payload, harness) {
      if (!stopped && payload.damageStepTiming === DAMAGE_STEP_TIMINGS.START) {
        stopped = true;
        harness.player.field.splice(
          harness.player.field.indexOf(attacker),
          1,
        );
      }
    },
  });
  const attacker = placeCard(player, "field", monster("Stopped", player.id));
  const defender = placeCard(bot, "field", monster("Safe", bot.id));

  const result = await game.executeDamageStepTransaction(
    game.createDamageStepTransaction({ attacker, defender }),
  );

  assert.equal(result.stoppedBeforeCalculation, true);
  assert.equal(result.damageDealt, 0);
  assert.equal(
    trace.events.some((entry) => entry.eventName === "battle_completed"),
    false,
  );
  assert.deepEqual(timingTrace(trace), [
    DAMAGE_STEP_TIMINGS.START,
    DAMAGE_STEP_TIMINGS.END,
  ]);
});

test("buffs de cálculo e de fim do Damage Step expiram separadamente", async () => {
  const observed = [];
  const { game, player, bot } = createDamageHarness({
    onWindow(_eventName, payload) {
      if (payload.damageStepTiming === DAMAGE_STEP_TIMINGS.CALCULATION) {
        attacker.atk += 500;
        attacker.tempAtkBoost = Number(attacker.tempAtkBoost || 0) + 500;
        game.damageCalculationTempBuffs.push({ card: attacker, atk: 500, def: 0 });
        attacker.atk += 300;
        attacker.tempAtkBoost += 300;
        game.endOfDamageStepTempBuffs.push({ card: attacker, atk: 300, def: 0 });
      } else if (
        payload.damageStepTiming === DAMAGE_STEP_TIMINGS.AFTER_CALCULATION ||
        payload.damageStepTiming === DAMAGE_STEP_TIMINGS.END
      ) {
        observed.push({ timing: payload.damageStepTiming, atk: attacker.atk });
      }
    },
  });
  const attacker = placeCard(
    player,
    "field",
    monster("Timed Buff", player.id, { atk: 1000, tempAtkBoost: 0 }),
  );
  const defender = placeCard(
    bot,
    "field",
    monster("Buff Target", bot.id, { atk: 900 }),
  );

  await game.executeDamageStepTransaction(
    game.createDamageStepTransaction({ attacker, defender }),
  );

  assert.deepEqual(observed, [
    { timing: DAMAGE_STEP_TIMINGS.AFTER_CALCULATION, atk: 1300 },
    { timing: DAMAGE_STEP_TIMINGS.END, atk: 1300 },
  ]);
  assert.equal(attacker.atk, 1000);
  assert.equal(attacker.tempAtkBoost, 0);
});

test("monstro determinado para destruição é excluído dos alvos de Flip Effect", () => {
  const { game, player, bot } = createDamageHarness();
  const doomed = placeCard(
    bot,
    "field",
    monster("Doomed", bot.id, { position: "defense" }),
  );
  const legal = placeCard(bot, "field", monster("Legal", bot.id));
  const result = selectCandidates.call(
    {
      _targetingCache: new Map(),
      getZone(owner, zone) {
        return owner?.[zone] || [];
      },
    },
    {
      id: "flip_target",
      owner: "opponent",
      zone: "field",
      cardKind: "monster",
    },
    {
      game,
      player,
      opponent: bot,
      activationContext: { excludedDamageStepTargets: [doomed] },
    },
  );

  assert.deepEqual(result.candidates, [legal]);
});

test("transação ativa bloqueia ação lenta e rejeita reentrada sem consumir ID", async () => {
  let reentryResult = null;
  const { game, player, bot } = createDamageHarness({
    onWindow(_eventName, payload) {
      if (payload.damageStepTiming !== DAMAGE_STEP_TIMINGS.START) return;
      reentryResult = game.createDamageStepTransaction({
        attacker,
        defenderOwner: bot,
      });
      game.canStartAction = canStartAction.bind(game);
      const guard = game.canStartAction({
        actor: player,
        kind: "normal_summon",
        silent: true,
      });
      assert.equal(guard.code, "BLOCKED_RESOLVING");
    },
  });
  const attacker = placeCard(player, "field", monster("Guarded", player.id));

  await game.executeDamageStepTransaction(
    game.createDamageStepTransaction({ attacker, defenderOwner: bot }),
  );
  const next = game.createDamageStepTransaction({ attacker, defenderOwner: bot });

  assert.equal(reentryResult.reason, "damage_step_already_active");
  assert.equal(next.damageStepId, 2);
});

test("erro limpa a sessão sem rollback e sem reutilizar damageStepId", async () => {
  let failed = false;
  const { game, player, bot } = createDamageHarness({
    onWindow(_eventName, payload) {
      if (
        !failed &&
        payload.damageStepTiming === DAMAGE_STEP_TIMINGS.AFTER_CALCULATION
      ) {
        failed = true;
        return { ok: false, reason: "forced_after_calculation_error" };
      }
    },
  });
  const attacker = placeCard(
    player,
    "field",
    monster("Committed", player.id, { atk: 1900 }),
  );
  const defender = placeCard(
    bot,
    "field",
    monster("Committed Target", bot.id, { atk: 1000 }),
  );

  const result = await game.executeDamageStepTransaction(
    game.createDamageStepTransaction({ attacker, defender }),
  );
  assert.equal(game.getDamageStepState().active, false);
  const next = game.createDamageStepTransaction({ attacker, defenderOwner: bot });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "forced_after_calculation_error");
  assert.equal(bot.lp, 7100);
  assert.ok(bot.graveyard.includes(defender));
  assert.equal(game.getDamageStepState().active, true);
  assert.equal(next.damageStepId, 2);
});

test("allowDamageStepActivation removido não autoriza Fast Effect genérico", () => {
  const result = canActivateDuringDamageStep(
    {
      id: "removed_damage_adapter",
      allowDamageStepActivation: true,
      isQuickEffect: true,
      actions: [{ type: "draw", amount: 1 }],
    },
    createTestCard({ cardKind: "monster" }),
    {
      isDamageStep: true,
      damageStepTiming: DAMAGE_STEP_TIMINGS.START,
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "DAMAGE_STEP_RESTRICTED");
});

function createBattleTriggerGame(t) {
  const game = new Game({
    captureReplay: false,
    laboratoryMode: true,
    phaseDelayMs: 0,
    animationDelayMs: 0,
  });
  game.turn = game.player.id;
  game.phase = "battle";
  game.battleStep = "battle";
  game.turnCounter = 2;
  game.disablePresentationDelays = true;
  game.waitForBoardPresentation = async () => {};
  game.player.controllerType = "ai";
  game.bot.controllerType = "ai";
  t.after(() => game.dispose("battle_destroy_context_test_complete"));
  return game;
}

function createRuntimeCard(data, owner) {
  const card = new Card(data, owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  return card;
}

async function resolveBattleDestroyTrigger(t, attackerName) {
  const game = createBattleTriggerGame(t);
  const attacker = createRuntimeCard(
    cardDatabaseByName.get(attackerName),
    game.player,
  );
  const defender = createRuntimeCard(
    {
      id: 999901,
      name: "Battle destroy context target",
      cardKind: "monster",
      atk: 2000,
      def: 1000,
      level: 4,
      type: "Warrior",
      attribute: "Dark",
      effects: [],
    },
    game.bot,
  );
  attacker.position = "attack";
  defender.position = "defense";
  defender.atk = 1600;
  game.player.field.push(attacker);
  game.bot.field.push(defender);
  game.player.lp = 4000;
  game.bot.lp = 8000;

  const result = await game.resolveCombat(attacker, defender);
  assert.equal(result.ok, true);
  assert.equal(game.bot.graveyard.includes(defender), true);
  assert.equal(game.chainSystem.isOpenGameState(), true);
  return game;
}

test("Aurora Seraph preserva a carta destruída no Trigger e cura pelo ATK atual", async (t) => {
  const game = await resolveBattleDestroyTrigger(t, "Luminarch Aurora Seraph");
  assert.equal(game.player.lp, 4800);
});

test("Rainbow Cosmic Dragon cura pelo ATK original da carta destruída", async (t) => {
  const game = await resolveBattleDestroyTrigger(t, "Rainbow Cosmic Dragon");
  assert.equal(game.player.lp, 6000);
});

test("Fire Extreme Dragon causa dano pelo ATK original da carta destruída", async (t) => {
  const game = await resolveBattleDestroyTrigger(t, "Fire Extreme Dragon");
  assert.equal(game.bot.lp, 7000);
});
