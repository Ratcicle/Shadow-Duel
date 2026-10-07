import type { TestContext } from "node:test";
import type { CardAction } from "../../src/core/contracts/actions.js";
import type {
  CardConstructorData,
  GameCard,
} from "../../src/core/contracts/cards.js";
import type { DamageStepTiming } from "../../src/core/contracts/effects.js";
import type { EffectContext } from "../../src/core/contracts/actionRuntime.js";
import type { EventPayloadBase } from "../../src/core/contracts/events.js";
import { applySimulatedActions } from "../../src/core/ai/common/simulatedActions/index.js";
import type { SimulatedActionContextData } from "../../src/core/ai/common/simulatedActions/shared.js";
import { simulationCard, simulationState } from "../helpers/simulation.js";
import type { DamageStepTransaction } from "../../src/core/contracts/gameRuntime.js";
import type { GamePlayer } from "../../src/core/contracts/player.js";
import type { PlayerId } from "../../src/core/contracts/primitives.js";
import { unsafeFixture } from "../helpers/fixtures.js";
import type { HarnessTrace } from "./helpers/chainHarness.js";
type DamageHost = ThisParameterType<typeof createDamageStepTransaction>;
type DamageHarness = Omit<
  ReturnType<typeof createChainHarness>,
  "game" | "player" | "bot" | "trace"
> & {
  game: DamageGame;
  player: DamageGame["player"];
  bot: DamageGame["bot"];
  trace: Omit<HarnessTrace, "actions"> & {
    actions: Array<{
      type?: string;
      attacker?: GameCard;
      target?: GameCard | null;
      card?: GameCard;
      timing?: DamageStepTiming | null;
      options?: Parameters<NonNullable<DamageHost["destroyCard"]>>[1];
    }>;
  };
};
type DamageGame = Omit<
  ReturnType<typeof createChainHarness>["game"],
  "getDamageStepState" | "emit" | "player" | "bot" | "checkAndOfferTraps"
> &
  DamageHost & {
    emit: NonNullable<DamageHost["emit"]>;
    canStartAction: OmitThisParameter<typeof canStartAction>;
    createDamageStepTransaction: (
      ...args: Parameters<typeof createDamageStepTransaction>
    ) => DamageStepTransaction;
    executeDamageStepTransaction: OmitThisParameter<
      typeof executeDamageStepTransaction
    >;
    getDamageStepState: OmitThisParameter<typeof getDamageStepState>;
    cleanupDamageStepTransaction: OmitThisParameter<
      typeof cleanupDamageStepTransaction
    >;
    clearDamageCalculationBuffs: OmitThisParameter<
      typeof clearDamageCalculationBuffs
    >;
    clearEndOfDamageStepBuffs: OmitThisParameter<
      typeof clearEndOfDamageStepBuffs
    >;
  };
interface DamageHarnessOptions {
  onWindow?: (
    event: string,
    payload: Parameters<NonNullable<DamageHost["checkAndOfferTraps"]>>[1],
    harness: DamageHarness,
  ) => unknown;
  onDestroy?: (
    card: GameCard,
    options: Parameters<NonNullable<DamageHost["destroyCard"]>>[1],
    harness: DamageHarness,
  ) => unknown;
}

import assert from "node:assert/strict";
import test from "node:test";
import { required } from "../helpers/fixtures.js";
import { createRuntimeGame, placeFieldCards, runtimeCard } from "../helpers/game.js";

import Card from "../../src/core/Card.js";
import { selectCandidates } from "../../src/core/effects/targeting/selection.js";
import { canStartAction } from "../../src/core/game/actions/guard.js";
import {
  cleanupDamageStepTransaction,
  clearDamageCalculationBuffs,
  clearEndOfDamageStepBuffs,
  createDamageStepTransaction,
  executeDamageStepTransaction,
  getDamageStepState,
} from "../../src/core/game/combat/damageStep.js";
import { DAMAGE_STEP_ACTIVATION_CATEGORIES, canActivateDuringDamageStep } from "../../src/core/game/spellTrap/quickSpellRules.js";
import { DAMAGE_STEP_TIMINGS } from "../../src/core/contracts/effects.js";
import { resetDuelState } from "../../src/core/game/state/duelReset.js";
import { isBattleDestructionProtected } from "../../src/core/game/zones/destruction.js";
import { cardDatabaseByName } from "../helpers/fixtures.js";
import {
  createChainHarness,
  createTestCard,
  placeCard,
} from "./helpers/chainHarness.js";

// Official baseline: Damage Step Rules and the official Rulebook.
// https://www.yugioh-card.com/eu/play/damage-step-rules/
// https://img.yugioh-card.com/en/downloads/rulebook/SD_RuleBook_EN_10.pdf

const DRAW_ONE: CardAction = { type: "draw", amount: 1 };

const FIVE_TIMINGS = [
  DAMAGE_STEP_TIMINGS.START,
  DAMAGE_STEP_TIMINGS.BEFORE_CALCULATION,
  DAMAGE_STEP_TIMINGS.CALCULATION,
  DAMAGE_STEP_TIMINGS.AFTER_CALCULATION,
  DAMAGE_STEP_TIMINGS.END,
];

function createDamageHarness(options: DamageHarnessOptions = {}) {
  const harness = unsafeFixture<DamageHarness>(
    createChainHarness({
      phase: "battle",
      playerControllerType: "ai",
      botControllerType: "ai",
    }),
    "The isolated Damage Step fixture installs only combat capabilities onto the minimal Chain host.",
  );
  const { game, player, bot, trace } = harness;
  game.battleStep = "battle";
  game.nextDamageStepId = 1;
  game.activeDamageStepTransaction = null;
  game.lastDamageStepTransaction = null;
  game.damageStepProcedureDepth = 0;
  game.damageCalculationTempBuffs = [];
  game.endOfDamageStepTempBuffs = [];
  game.createDamageStepTransaction = (...args) => {
    const transaction = createDamageStepTransaction.call(game, ...args);
    assert.ok(
      "damageStepId" in transaction,
      "The combat fixture must prepare a valid Damage Step.",
    );
    return transaction;
  };
  game.executeDamageStepTransaction = executeDamageStepTransaction.bind(game);
  game.getDamageStepState = getDamageStepState.bind(game);
  game.cleanupDamageStepTransaction = cleanupDamageStepTransaction.bind(game);
  game.clearDamageCalculationBuffs = clearDamageCalculationBuffs.bind(game);
  game.clearEndOfDamageStepBuffs = clearEndOfDamageStepBuffs.bind(game);
  game.waitForPresentationDelay = async () => {};
  game.effectEngine.clearTargetingCache = () => {};
  game.canDestroyByBattle = () => true;
  game.isBattleDestructionProtected = isBattleDestructionProtected.bind(
    unsafeFixture<ThisParameterType<typeof isBattleDestructionProtected>>(
      game,
      "Damage Step fixture provides the battle protection read model without full zone orchestration.",
    ),
  );
  game.markAttackUsed = (attacker, target) => {
    attacker.attacksUsedThisTurn =
      Number(attacker.attacksUsedThisTurn || 0) + 1;
    required(trace.actions).push({ type: "attack_used", attacker, target });
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
  game.destroyCard = async (card, destroyOptions) => {
    const owner = card.owner === player.id ? player : bot;
    if (typeof options.onDestroy === "function") {
      await options.onDestroy(card, destroyOptions, harness);
    }
    required(trace.actions).push({
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

function monster(
  name: string,
  owner: PlayerId,
  overrides: Partial<GameCard> = {},
): GameCard {
  const card = new Card(
    { name, cardKind: "monster", atk: 1800, def: 1000 },
    owner,
  );
  return Object.assign(card, {
    instanceId: unsafeFixture<number>(
      `${owner}-${name}`,
      "Legacy combat snapshots identify fixtures with string instance IDs.",
    ),
    name,
    owner,
    cardKind: "monster",
    atk: 1800,
    def: 1000,
    position: "attack",
    ...overrides,
  });
}

function timingTrace(trace: Pick<HarnessTrace, "events">) {
  return trace.events
    .filter(
      (entry) =>
        entry.channel === "notify" && entry.eventName === "damage_step_timing",
    )
    .map((entry) => required(required(entry.payload).timing));
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
  assert.ok("targetDestroyed" in result);

  assert.ok(result.ok === true);
  assert.deepEqual(timingTrace(trace), FIVE_TIMINGS);
  assert.equal(game.getDamageStepState().active, false);
  assert.equal(required(game.getDamageStepState().last).status, "completed");
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
  assert.deepEqual(
    checks.map((entry) => entry.ok),
    [true, true, false, false, false],
  );
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
  assert.ok(explicit.ok === true);
  assert.equal(
    explicit.category,
    DAMAGE_STEP_ACTIVATION_CATEGORIES.EXPLICIT_TIMING,
  );

  const generic = canActivateDuringDamageStep(
    { isQuickEffect: true, actions: [DRAW_ONE] },
    createTestCard({ cardKind: "monster" }),
    { isDamageStep: true, damageStepTiming: DAMAGE_STEP_TIMINGS.START },
  );
  assert.ok(generic.ok === false);
  assert.equal(generic.code, "DAMAGE_STEP_RESTRICTED");
  assert.equal(
    generic.category,
    DAMAGE_STEP_ACTIVATION_CATEGORIES.GENERIC_FAST_EFFECT,
  );
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
  assert.ok("targetDestroyed" in result);

  assert.ok(result.ok === true);
  assert.equal(result.damageDealt, 2100);
  assert.equal(bot.lp, 5900);
  assert.deepEqual(timingTrace(trace), FIVE_TIMINGS);
  assert.equal(trace.moves.length, 0);
  assert.equal(required(game.getDamageStepState().last).directAttack, true);
  assert.equal(required(game.getDamageStepState().last).defender, null);
});

test("[CS-10] Flip, dano, destruição e envio ao Cemitério ocorrem nas etapas corretas", async () => {
  const { game, player, bot, trace } = createDamageHarness();
  const observations: Array<{
    eventName: string;
    timing: unknown;
    botLp: number;
    defenderOnField: boolean;
  }> = [];
  const baseEmit = required(game.emit.bind(game));
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
  assert.ok("targetDestroyed" in result);

  const flipped = observations.find(
    (entry) => entry.eventName === "card_flipped",
  );
  const damaged = observations.find(
    (entry) => entry.eventName === "battle_damage_inflicted",
  );
  const completed = observations.find(
    (entry) => entry.eventName === "battle_completed",
  );
  const toGrave = observations.find(
    (entry) => entry.eventName === "card_to_grave",
  );
  assert.equal(required(flipped).timing, DAMAGE_STEP_TIMINGS.AFTER_CALCULATION);
  assert.equal(required(flipped).botLp, 7200);
  assert.equal(required(flipped).defenderOnField, true);
  assert.equal(required(damaged).timing, DAMAGE_STEP_TIMINGS.AFTER_CALCULATION);
  assert.equal(required(damaged).defenderOnField, true);
  assert.equal(
    required(completed).timing,
    DAMAGE_STEP_TIMINGS.AFTER_CALCULATION,
  );
  assert.equal(required(toGrave).timing, DAMAGE_STEP_TIMINGS.END);
  assert.equal(result.targetDestroyed, true);
  assert.equal(bot.field.includes(defender), false);
  assert.equal(bot.graveyard.includes(defender), true);
  assert.equal(defender.isFacedown, false);
  assert.equal(
    required(required(trace.actions).find((entry) => entry.type === "destroy"))
      .timing,
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
  assert.ok("targetDestroyed" in result);

  assert.ok(result.ok === true);
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
  assert.ok("targetDestroyed" in result);

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
  assert.ok("targetDestroyed" in result);

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
  assert.ok("targetDestroyed" in result);
  const destroys = required(trace.actions).filter(
    (entry) => entry.type === "destroy",
  );

  assert.equal(result.attackerDestroyed, true);
  assert.equal(result.targetDestroyed, true);
  assert.deepEqual(
    trace.moves.map((entry) => entry.card),
    [attacker, defender],
  );
  assert.equal(destroys.length, 2);
  assert.equal(
    required(required(destroys[0]).options).atomicGroupId,
    required(required(destroys[1]).options).atomicGroupId,
  );
  const destructions = trace.events.filter(
    (entry) => entry.channel === "emit" && entry.eventName === "battle_destroy",
  );
  assert.equal(destructions.length, 2);
  const firstDestruction = required(required(destructions[0]).payload);
  assert.equal(firstDestruction.attacker, defender);
  assert.equal(firstDestruction.attackerOwner, bot);
  assert.equal(firstDestruction.destroyedOwner, player);
  const secondDestruction = required(required(destructions[1]).payload);
  assert.equal(secondDestruction.attacker, attacker);
  assert.equal(secondDestruction.attackerOwner, player);
  assert.equal(secondDestruction.destroyedOwner, bot);
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
  assert.ok("targetDestroyed" in result);

  assert.ok(result.ok === false);
  assert.match(result.reason, /forced_destruction_error/);
  assert.deepEqual(
    trace.moves.map((entry) => entry.card),
    [attacker, defender],
  );
  assert.ok(player.graveyard.includes(attacker));
  assert.ok(bot.graveyard.includes(defender));
  assert.equal(game.getDamageStepState().active, false);
});

test("Counter Trap e negação de ativação permanecem legais no timing exato", () => {
  const counterCard = createTestCard({ cardKind: "trap", subtype: "counter" });
  for (const timing of FIVE_TIMINGS) {
    const legality = canActivateDuringDamageStep(
      { actions: [DRAW_ONE] },
      counterCard,
      { isDamageStep: true, damageStepTiming: timing },
    );
    assert.ok(legality.ok === true);
    assert.equal(
      legality.category,
      DAMAGE_STEP_ACTIVATION_CATEGORIES.COUNTER_TRAP,
    );
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
  assert.ok(negation.ok === true);
  assert.equal(
    negation.category,
    DAMAGE_STEP_ACTIVATION_CATEGORIES.ACTIVATION_NEGATION,
  );
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

  let selectionTeardowns = 0;
  Object.assign(game, { forceClearTargetSelection() { selectionTeardowns++; } });
  resetDuelState.call(
    unsafeFixture<ThisParameterType<typeof resetDuelState>>(
      game,
      "Combat reset fixture exercises cleanup with presentation and analytics capabilities intentionally absent.",
    ),
    "damage_step_reset",
    {
      turn: "player",
      phase: "battle",
      turnCounter: 0,
    },
  );
  const next = game.createDamageStepTransaction({
    attacker,
    defenderOwner: bot,
  });

  assert.equal(selectionTeardowns, 1, "reset delegates selection teardown; real sessions are covered by selectionSession tests");
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

  const publicState = game.getPublicState!(player.id);
  assert.equal(publicState.combat.damageStep.active, true);
  assert.equal(
    required(required(publicState.combat.damageStep.transaction).defender).name,
    null,
  );
  assert.doesNotThrow(() => JSON.stringify(publicState.combat));
});

test("ataque interrompido antes do cálculo não publica battle_completed", async () => {
  let stopped = false;
  const { game, player, bot, trace } = createDamageHarness({
    onWindow(_eventName, payload, harness) {
      if (!stopped && payload.damageStepTiming === DAMAGE_STEP_TIMINGS.START) {
        stopped = true;
        harness.player.field.splice(harness.player.field.indexOf(attacker), 1);
      }
    },
  });
  const attacker = placeCard(player, "field", monster("Stopped", player.id));
  const defender = placeCard(bot, "field", monster("Safe", bot.id));

  const result = await game.executeDamageStepTransaction(
    game.createDamageStepTransaction({ attacker, defender }),
  );
  assert.ok("targetDestroyed" in result);

  assert.ok(result.ok);
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
  const observed: Array<{ timing: DamageStepTiming; atk: number }> = [];
  const { game, player, bot } = createDamageHarness({
    onWindow(_eventName, payload) {
      if (payload.damageStepTiming === DAMAGE_STEP_TIMINGS.CALCULATION) {
        attacker.atk += 500;
        attacker.tempAtkBoost = Number(attacker.tempAtkBoost || 0) + 500;
        game.damageCalculationTempBuffs.push({
          card: attacker,
          atk: 500,
          def: 0,
        });
        attacker.atk += 300;
        attacker.tempAtkBoost += 300;
        game.endOfDamageStepTempBuffs.push({
          card: attacker,
          atk: 300,
          def: 0,
        });
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
    unsafeFixture<ThisParameterType<typeof selectCandidates>>(
      {
        _targetingCache: new Map(),
        getZone(owner: object | null, zone: string) {
          return owner && zone !== "both" && zone !== "any"
            ? Reflect.get(owner, zone) || []
            : [];
        },
      },
      "Target selection fixture supplies only cache and zone reads.",
    ),
    {
      id: "flip_target",
      owner: "opponent",
      zone: "field",
      cardKind: "monster",
    },
    unsafeFixture<Parameters<typeof selectCandidates>[1]>(
      {
        game,
        player,
        opponent: bot,
        activationContext: { excludedDamageStepTargets: [doomed] },
      },
      "Combat fixture supplies the real exclusions and minimal targeting player projections.",
    ),
  );

  assert.deepEqual(result.candidates, [legal]);
});

test("transação ativa bloqueia ação lenta e rejeita reentrada sem consumir ID", async () => {
  let reentryResult = null as ReturnType<
    typeof createDamageStepTransaction
  > | null;
  const { game, player, bot } = createDamageHarness({
    onWindow(_eventName, payload) {
      if (payload.damageStepTiming !== DAMAGE_STEP_TIMINGS.START) return;
      reentryResult = createDamageStepTransaction.call(game, {
        attacker,
        defenderOwner: bot,
      });
      game.canStartAction = canStartAction.bind(
        unsafeFixture<ThisParameterType<typeof canStartAction>>(
          game,
          "The active combat transaction is enough to reject a slow action before other Game capabilities are read.",
        ),
      );
      const guard = game.canStartAction({
        actor: player,
        kind: "normal_summon",
        silent: true,
      });
      assert.ok(!guard.ok);
      assert.equal(guard.code, "BLOCKED_RESOLVING");
    },
  });
  const attacker = placeCard(player, "field", monster("Guarded", player.id));

  await game.executeDamageStepTransaction(
    game.createDamageStepTransaction({ attacker, defenderOwner: bot }),
  );
  const next = game.createDamageStepTransaction({
    attacker,
    defenderOwner: bot,
  });

  assert.ok(reentryResult && "reason" in reentryResult);
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
      return undefined;
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
  assert.ok("targetDestroyed" in result);
  assert.equal(game.getDamageStepState().active, false);
  const next = game.createDamageStepTransaction({
    attacker,
    defenderOwner: bot,
  });

  assert.ok(result.ok === false);
  assert.equal(result.reason, "forced_after_calculation_error");
  assert.equal(bot.lp, 7100);
  assert.ok(bot.graveyard.includes(defender));
  assert.equal(game.getDamageStepState().active, true);
  assert.equal(next.damageStepId, 2);
});

test("allowDamageStepActivation removido não autoriza Fast Effect genérico", () => {
  const result = canActivateDuringDamageStep(
    unsafeFixture<Parameters<typeof canActivateDuringDamageStep>[0]>(
      {
        id: "removed_damage_adapter",
        allowDamageStepActivation: true,
        isQuickEffect: true,
        actions: [DRAW_ONE],
      },
      "Removed allowDamageStepActivation metadata is deliberately passed to verify it grants no permission.",
    ),
    createTestCard({ cardKind: "monster" }),
    {
      isDamageStep: true,
      damageStepTiming: DAMAGE_STEP_TIMINGS.START,
    },
  );
  assert.ok(result.ok === false);
  assert.equal(result.code, "DAMAGE_STEP_RESTRICTED");
});

function createBattleTriggerGame(t: TestContext) {
  const game = createRuntimeGame({
    captureReplay: false,
    laboratoryMode: true,
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

function createRuntimeCard(
  data: CardConstructorData | undefined,
  owner: GamePlayer,
) {
  const card = new Card(required(data), owner.id);
  card.owner = owner.id;
  card.controller = owner.id;
  return card;
}

async function resolveBattleDestroyTrigger(
  t: TestContext,
  attackerName: string,
) {
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
  attacker.fieldSlot = 0;
  defender.fieldSlot = 0;
  game.player.field.push(attacker);
  game.bot.field.push(defender);
  game.player.lp = 4000;
  game.bot.lp = 8000;

  const result = required(await game.resolveCombat(attacker, defender));
  assert.ok(result.ok === true);
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

function createAttackPresenceGame(t: TestContext, direct = false) {
  const game = createBattleTriggerGame(t);
  const attacker = runtimeCard({ name: "Presence attacker", cardKind: "monster",
    atk: 2000, def: 1000, level: 4, position: "attack", effects: [] }, "player");
  const defender = runtimeCard({ name: "Presence defender", cardKind: "monster",
    atk: 1000, def: 500, level: 4, position: "attack", effects: [] }, "bot");
  placeFieldCards(game.player.field, attacker);
  if (!direct) placeFieldCards(game.bot.field, defender);
  const observed = { declarations: 0, damageSteps: 0, resolved: 0, visualDamage: 0, impacts: 0 };
  game.on("attack_declared", () => { observed.declarations++; });
  game.on("damage_step", () => { observed.damageSteps++; });
  game.on("combat_resolved", () => { observed.resolved++; });
  game.ui.showLpDamageSequence = () => { observed.visualDamage++; return true; };
  game.ui.playBattleImpactImmediate = () => { observed.impacts++; return true; };
  const leaveAndReturn = async (card: Card) => {
    const owner = card === attacker ? game.player : game.bot;
    const departed = await game.moveCard(card, owner, "graveyard", { fromZone: "field", awaitCardMovedEvent: true });
    assert.equal(departed.success, true);
    const returned = await game.moveCard(card, owner, "field", { fromZone: "graveyard",
      summonMethod: "special", summonOrigin: "effect_resolution", position: "attack",
      isFacedown: false, resetAttackFlags: true, awaitCardMovedEvent: true });
    assert.equal(returned.success, true);
  };
  return { game, attacker, defender, observed, leaveAndReturn };
}

for (const stage of ["before_declaration", "after_declaration", "presentation", "contact"] as const) {
  for (const participant of ["attacker", "defender", "direct_attacker"] as const) {
    test(`attack presence interrupts ${participant} leaving and returning at ${stage}`, async t => {
      const direct = participant === "direct_attacker";
      const { game, attacker, defender, observed, leaveAndReturn } = createAttackPresenceGame(t, direct);
      const moved = participant === "defender" ? defender : attacker;
      const originalVersion = moved.locationVersion;
      if (stage === "contact" && !direct) {
        defender.effects = [{ id: "presence_damage_step_marker", timing: "on_event", event: "damage_step",
          damageStepTimings: [DAMAGE_STEP_TIMINGS.START], triggerRequirement: "mandatory", triggerTiming: "if",
          actions: [{ type: "heal", amount: 0, player: "self" }] }];
      }
      if (stage === "before_declaration") {
        const check = game.checkAndOfferTraps.bind(game);
        let movedOnce = false;
        game.checkAndOfferTraps = async (event, payload) => {
          const result = await check(event, payload);
          if (event === "battle_step_open" && !movedOnce) {
            movedOnce = true;
            await leaveAndReturn(moved);
          }
          return result;
        };
      } else if (stage === "after_declaration") {
        const check = game.checkAndOfferTraps.bind(game);
        game.checkAndOfferTraps = async (event, payload) => {
          const result = await check(event, payload);
          if (event === "attack_declared") await leaveAndReturn(moved);
          return result;
        };
      } else {
        game.ui.playAttackLunge = options => {
          const contact = leaveAndReturn(moved).then(() => {
            options?.onContact?.({});
            return true;
          });
          return Object.assign(contact, { contact, finished: contact, cancel: async () => false });
        };
      }
      assert.equal(required(await game.resolveCombat(attacker, direct ? null : defender)).ok, true);
      assert.ok(moved.locationVersion > originalVersion, "the same object really leaves and returns");
      assert.ok((moved === attacker ? game.player : game.bot).field.includes(moved));
      assert.deepEqual([game.player.lp, game.bot.lp], [8000, 8000]);
      assert.equal(observed.declarations, stage === "before_declaration" ? 0 : 1);
      assert.equal(observed.damageSteps, 0, "interruption precedes Damage Step creation");
      assert.equal(observed.resolved, 0);
      assert.equal(observed.visualDamage, 0, "stale contact cannot preview LP damage");
      assert.equal(observed.impacts, 0, "stale contact cannot publish an impact");
      assert.equal(attacker.attacksUsedThisTurn,
        participant === "defender" && stage !== "before_declaration" ? 1 : 0);
      assert.equal(attacker.hasAttacked, participant === "defender" && stage !== "before_declaration");
      assert.equal(game.getDamageStepState().active, false);
      assert.equal(game.chainSystem.isOpenGameState(), true);
    });
  }
}

test("attack presence preserves fresh attacker counters after a real mandatory Chain summon", async t => {
  const { game, attacker, observed } = createAttackPresenceGame(t, true);
  attacker.effects = [{ id: "presence_chain_departure", timing: "on_event", event: "attack_declared",
    requireSelfAsAttacker: true, triggerRequirement: "mandatory", triggerTiming: "if",
    actions: [{ type: "move", targetRef: "self", player: "self", fromZone: "field", to: "graveyard" }] },
  { id: "presence_chain_return", timing: "on_event", event: "card_to_grave",
    triggerRequirement: "mandatory", triggerTiming: "if",
    actions: [{ type: "special_summon_from_zone", zone: "graveyard", requireSource: true, position: "attack" }] }];
  let resolvedLinks = 0;
  game.on("chain_link_resolution", event => { if (event.stage === "completed") resolvedLinks++; });
  await game.resolveCombat(attacker, null);
  assert.ok(resolvedLinks >= 2, "both effects resolve through the real Chain");
  assert.ok(game.player.field.includes(attacker));
  assert.equal(game.bot.lp, 8000);
  assert.equal(attacker.attacksUsedThisTurn, 0);
  assert.equal(attacker.hasAttacked, false);
  assert.equal(observed.damageSteps, 0);
});

for (const freshAttacker of [false, true]) {
  test(`attack presence releases second-attack reservation only for the original presence (${freshAttacker})`, async t => {
    const { game, attacker, defender, leaveAndReturn, observed } = createAttackPresenceGame(t);
    attacker.attacksUsedThisTurn = 1;
    attacker.hasAttacked = true;
    attacker.canMakeSecondAttackThisTurn = true;
    const check = game.checkAndOfferTraps.bind(game);
    game.checkAndOfferTraps = async (event, payload) => {
      const result = await check(event, payload);
      if (event === "battle_step_open") {
        await leaveAndReturn(freshAttacker ? attacker : defender);
        if (freshAttacker) attacker.secondAttackUsedThisTurn = true;
      }
      return result;
    };
    await game.resolveCombat(attacker, defender);
    assert.equal(observed.declarations, 0);
    assert.equal(attacker.attacksUsedThisTurn, freshAttacker ? 0 : 1);
    assert.equal(attacker.secondAttackUsedThisTurn, freshAttacker);
  });
}

test("attack presence negation does not consume a newly summoned attacker", async t => {
  const { game, attacker, defender, leaveAndReturn, observed } = createAttackPresenceGame(t);
  const check = game.checkAndOfferTraps.bind(game);
  game.checkAndOfferTraps = async (event, payload) => {
    const result = await check(event, payload);
    if (event === "attack_declared") {
      await leaveAndReturn(attacker);
      game.lastAttackNegated = true;
    }
    return result;
  };
  await game.resolveCombat(attacker, defender);
  assert.equal(attacker.attacksUsedThisTurn, 0);
  assert.equal(attacker.hasAttacked, false);
  assert.equal(observed.damageSteps, 0);
});

for (const invalidation of ["return_before_read", "return_redirect_window", "legacy_only", "controller"] as const) {
  test(`attack redirect presence rejects ${invalidation} without falling back to the original target`, async t => {
    const { game, attacker, defender, observed, leaveAndReturn } = createAttackPresenceGame(t);
    const redirect = runtimeCard({ name: "Redirect target", cardKind: "monster", atk: 500,
      def: 500, level: 4, position: "attack", effects: [] }, "bot");
    placeFieldCards(game.bot.field, redirect);
    let windows = 0;
    const check = game.checkAndOfferTraps.bind(game);
    game.checkAndOfferTraps = async (event, payload) => {
      const result = await check(event, payload);
      if (event === "battle_step_open" && ++windows === 2 && invalidation === "return_redirect_window") {
        await leaveAndReturn(redirect);
      }
      if (event === "attack_declared") {
        const actionContext = unsafeFixture<NonNullable<EffectContext["actionContext"]>>(required(payload),
          "The real attack response window carries the combat participant context consumed by the redirect action.");
        const redirected = await game.effectEngine.applyActions(
          [{ type: "redirect_current_attack_to_target", targetRef: "redirect" }],
          { source: redirect, player: game.bot, opponent: game.player,
            effect: { id: "presence_redirect", timing: "manual", activationZones: ["field"] }, actionContext }, { redirect: [redirect] });
        assert.equal(redirected.success, true);
        if (invalidation === "return_before_read") await leaveAndReturn(redirect);
        if (invalidation === "legacy_only") delete required(payload).attackRedirect;
        if (invalidation === "controller") assert.equal((await game.takeControl(redirect, game.player)).success, true);
      }
      return result;
    };
    await game.resolveCombat(attacker, defender);
    assert.deepEqual([game.player.lp, game.bot.lp], [8000, 8000]);
    assert.ok(game.bot.field.includes(defender));
    assert.ok((invalidation === "controller" ? game.player : game.bot).field.includes(redirect));
    assert.equal(observed.damageSteps, 0);
    assert.equal(observed.resolved, 0);
    assert.equal(attacker.attacksUsedThisTurn, 1);
  });
}

test("attack presence permits a defender changing face without leaving the field", async t => {
  const { game, attacker, defender, observed } = createAttackPresenceGame(t);
  game.on("attack_declared", () => { defender.position = "defense"; defender.isFacedown = true; });
  await game.resolveCombat(attacker, defender);
  assert.ok(game.bot.graveyard.includes(defender));
  assert.equal(observed.damageSteps, 5);
  assert.equal(observed.resolved, 1);
  assert.equal(attacker.attacksUsedThisTurn, 1);
});

test("attack redirect presence follows Ambush in Crash Town's newly summoned monster", async t => {
  const { game, attacker, defender, observed } = createAttackPresenceGame(t);
  attacker.atk = 3000;
  const trap = createRuntimeCard(cardDatabaseByName.get("Ambush in Crash Town"), game.bot);
  const replacement = createRuntimeCard(cardDatabaseByName.get("Gunslinger of the Burning West"), game.bot);
  trap.isFacedown = true;
  trap.setTurn = trap.turnSetOn = 1;
  placeFieldCards(game.bot.spellTrap, trap);
  game.bot.hand.push(replacement);
  game.bot.strategy = { chooseChainResponse: ({ activatable }) =>
    activatable.find(candidate => candidate.card === trap) || { pass: true } };
  let selectedVersion: number | undefined;
  const check = game.checkAndOfferTraps.bind(game);
  game.checkAndOfferTraps = async (event, payload) => {
    const result = await check(event, payload);
    if (event === "attack_declared") {
      const attackContext = unsafeFixture<EventPayloadBase>(required(payload),
        "The real attack window exposes the typed mutable event redirect capability.");
      assert.strictEqual(attackContext.attackRedirect?.target, replacement);
      selectedVersion = attackContext.attackRedirect?.targetLocationVersion;
      assert.equal(selectedVersion, replacement.locationVersion);
    }
    return result;
  };
  let battled: unknown = null;
  game.on("combat_resolved", payload => { battled = payload.target; });
  await game.resolveCombat(attacker, defender);
  assert.ok(selectedVersion !== undefined && selectedVersion > 0, "redirect records the new summon presence");
  assert.strictEqual(battled, replacement);
  assert.ok(game.bot.field.includes(defender), "the original target is spared");
  assert.ok(game.bot.graveyard.includes(trap));
  assert.equal(observed.damageSteps, 5);
  assert.equal(observed.resolved, 1);
  assert.equal(attacker.attacksUsedThisTurn, 1);
});

test("attack redirect presence is captured by the simulation producer", () => {
  const target = simulationCard({ id: 1, name: "Simulated redirect", cardKind: "monster",
    owner: "bot", controller: "bot", atk: 1000, def: 1000, level: 4, locationVersion: 7 });
  const state = simulationState({ bot: { field: [target] } });
  const actionContext: SimulatedActionContextData = {};
  assert.equal(applySimulatedActions({ state, selfId: "bot",
    actions: [{ type: "redirect_current_attack_to_target", targetRef: "redirect" }],
    selections: { redirect: [target] }, options: { actionContext } }), true);
  assert.strictEqual(actionContext.attackRedirect?.target, target);
  assert.equal(actionContext.attackRedirect?.targetLocationVersion, 7);
  target.locationVersion = 8;
  assert.equal(actionContext.attackRedirect?.targetLocationVersion, 7, "later movements do not recapture the redirect");
});

test("attack redirect presence can replace a departed original target through nested context roots", async t => {
  const { game, attacker, defender, leaveAndReturn, observed } = createAttackPresenceGame(t);
  const redirected = runtimeCard({ name: "Valid replacement", cardKind: "monster",
    atk: 1500, def: 1000, level: 4, position: "attack", effects: [] }, "bot");
  placeFieldCards(game.bot.field, redirected);
  const check = game.checkAndOfferTraps.bind(game);
  game.checkAndOfferTraps = async (event, payload) => {
    const result = await check(event, payload);
    if (event === "attack_declared") {
      await leaveAndReturn(defender);
      const root = required(payload);
      // A cycle is deliberately included to prove bounded propagation through
      // existing mutable runtime context links without touching participant data.
      Object.assign(root, { _chainRootContext: root });
      const context = { attacker, attackerOwner: game.player, _chainRootContext: { _chainRootContext: root } };
      const actionContext = unsafeFixture<NonNullable<EffectContext["actionContext"]>>(context,
        "The redirect action reads a narrow attack context retained through nested Chain response roots.");
      assert.equal((await game.effectEngine.applyActions(
        [{ type: "redirect_current_attack_to_target", targetRef: "redirect" }],
        { source: redirected, player: game.bot, opponent: game.player,
          effect: { id: "nested_presence_redirect", timing: "manual", activationZones: ["field"] }, actionContext },
        { redirect: [redirected] })).success, true);
    }
    return result;
  };
  await game.resolveCombat(attacker, defender);
  assert.equal(game.bot.lp, 7500);
  assert.ok(game.bot.field.includes(defender));
  assert.ok(game.bot.graveyard.includes(redirected));
  assert.equal(attacker.attacksUsedThisTurn, 1);
  assert.equal(observed.damageSteps, 5);
  assert.equal(observed.resolved, 1);
});

test("attack redirect presence preserves the response window before consuming a valid negated attack", async t => {
  const { game, attacker, defender, observed } = createAttackPresenceGame(t);
  let openWindows = 0;
  const check = game.checkAndOfferTraps.bind(game);
  game.checkAndOfferTraps = async (event, payload) => {
    const result = await check(event, payload);
    if (event === "battle_step_open") openWindows++;
    if (event === "attack_declared") {
      Object.assign(required(payload), { attackRedirect: { target: defender,
        targetOwner: game.bot, targetLocationVersion: defender.locationVersion } });
      game.lastAttackNegated = true;
    }
    return result;
  };
  await game.resolveCombat(attacker, defender);
  assert.equal(openWindows, 2);
  assert.equal(attacker.attacksUsedThisTurn, 1);
  assert.equal(observed.damageSteps, 0);
  assert.deepEqual([game.player.lp, game.bot.lp], [8000, 8000]);
});
