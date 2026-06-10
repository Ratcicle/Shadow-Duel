import Game from "../src/core/Game.js";
import {
  cardDatabase,
  cardDatabaseByName,
} from "../src/data/cards.js";
import {
  canActivateDuringDamageStep,
  canActivateInDamageStep,
  canActivateQuickSpell,
  canActivateQuickSpellFromHand,
  canActivateSetQuickSpell,
  effectDirectlyChangesAtkDef,
  getQuickSpellActivationZone,
  isQuickSpell,
} from "../src/core/game/spellTrap/quickSpellRules.js";

const args = new Set(process.argv.slice(2));
const verbose = args.has("--verbose");
const jsonOutput = args.has("--json");

const STATUS_ORDER = {
  reproduced: 0,
  current_behavior: 1,
  manual: 2,
  blocked: 3,
  unexpected: 4,
};

const SMOKE_MAIN_DECK_IDS = cardDatabase
  .filter((card) => card.cardKind && !card.monsterType)
  .slice(0, 20)
  .map((card) => card.id);

function createMockRenderer(options = {}) {
  const state = {
    logs: [],
    phaseHandler: null,
  };
  const noop = () => {};
  const renderer = {
    __state: state,
    log(message) {
      state.logs.push(String(message ?? ""));
    },
    showMessage(message) {
      state.logs.push(String(message ?? ""));
    },
    showAlert(message) {
      state.logs.push(String(message ?? ""));
    },
    showConfirmPrompt() {
      return options.confirm ?? true;
    },
    showSpecialSummonPositionModal(_card, onSelect) {
      onSelect?.(options.specialSummonPosition || "attack");
    },
    showTrapActivationModal() {
      return Promise.resolve(options.confirmTrap ?? true);
    },
    showDuelStartAnnouncement() {
      return Promise.resolve();
    },
    bindPhaseClick(handler) {
      state.phaseHandler = handler;
    },
    captureCardRects() {
      return null;
    },
    captureCardAnimationSource() {
      return null;
    },
    renderHand: noop,
    renderField: noop,
    renderSpellTrap: noop,
    renderFieldSpell: noop,
    updateLP: noop,
    updatePhaseTrack: noop,
    updateTurn: noop,
    updateGYPreview: noop,
    updateExtraDeckPreview: noop,
    applyHandTargetableIndices: noop,
    hideFieldTargetingControls: noop,
    playQueuedCardAnimations: noop,
    playVisualFeedback: noop,
    animateCardLayout: noop,
  };

  return new Proxy(renderer, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return noop;
    },
  });
}

function createSmokeGame(options = {}) {
  const renderer = createMockRenderer(options.renderer || {});
  const game = new Game({
    renderer,
    laboratoryMode: true,
    laboratoryUseBot: false,
    disableChains: options.disableChains ?? true,
  });
  game.phaseDelayMs = 0;
  game.aiActionDelayMs = 0;
  game.aiSuccessfulActionDelayMs = 0;
  game.aiPresentationStepDelayMs = 0;
  game.aiBattleDelayMs = 0;
  return { game, renderer };
}

function createCard(game, owner, name, overrides = {}) {
  const card = game.createCardForOwner(name, owner, overrides);
  if (!card) {
    throw new Error(`Card not found for smoke: ${name}`);
  }
  return card;
}

function markerCard(game, owner, marker, name = "Mirror Force") {
  const card = createCard(game, owner, name);
  card.__smokeMarker = marker;
  return card;
}

async function startSmokeDuel(game) {
  await game.startWithDecks({
    playerDeck: SMOKE_MAIN_DECK_IDS,
    botDeck: SMOKE_MAIN_DECK_IDS,
    playerExtraDeck: [],
    botExtraDeck: [],
    startingPlayer: "player",
    firstTurnPlayer: "player",
    exactDecks: false,
    startAtDrawPhase: true,
    announceStartingPlayer: false,
  });
}

function hasMarker(zone, marker) {
  return Array.isArray(zone) && zone.some((card) => card?.__smokeMarker === marker);
}

function compact(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return String(value);
  }
}

async function smokeResetReuse() {
  const { game } = createSmokeGame();
  await startSmokeDuel(game);

  game.player.lp = 1234;
  game.player.hand.push(markerCard(game, game.player, "hand_leak"));
  game.player.field.push(markerCard(game, game.player, "field_leak"));
  game.player.graveyard.push(markerCard(game, game.player, "grave_leak"));
  game.player.spellTrap.push(markerCard(game, game.player, "spelltrap_leak"));
  game.player.additionalNormalSummons = 2;
  game.delayedActions.push({ __smokeMarker: "delayed_leak" });
  game.turnCounter = 7;
  game.oncePerTurnUsage.player.set("smoke_lock", true);
  game.player.oncePerDuelUsageByName = { smoke_duel_lock: true };

  await startSmokeDuel(game);

  const leaks = [];
  if (game.player.lp === 1234) leaks.push("player.lp");
  if (hasMarker(game.player.hand, "hand_leak")) leaks.push("player.hand");
  if (hasMarker(game.player.field, "field_leak")) leaks.push("player.field");
  if (hasMarker(game.player.graveyard, "grave_leak")) leaks.push("player.graveyard");
  if (hasMarker(game.player.spellTrap, "spelltrap_leak")) {
    leaks.push("player.spellTrap");
  }
  if (game.player.additionalNormalSummons === 2) {
    leaks.push("player.additionalNormalSummons");
  }
  if (game.delayedActions.some((entry) => entry?.__smokeMarker === "delayed_leak")) {
    leaks.push("game.delayedActions");
  }
  if (game.turnCounter === 7) leaks.push("game.turnCounter");
  if (game.oncePerTurnUsage?.player?.has?.("smoke_lock")) {
    leaks.push("game.oncePerTurnUsage.player");
  }
  if (game.player.oncePerDuelUsageByName?.smoke_duel_lock === true) {
    leaks.push("player.oncePerDuelUsageByName");
  }

  game.dispose?.("smoke_reset_reuse");
  return {
    status: leaks.length ? "unexpected" : "current_behavior",
    detail: leaks.length
      ? `state leaked after second startWithDecks: ${leaks.join(", ")}`
      : "second startWithDecks reset LP, zones, turnCounter, delayedActions, once-per-turn, and once-per-duel",
  };
}

async function smokeDeckEmptyDraw() {
  const { game } = createSmokeGame();
  game.player.deck = [];
  const result = game.drawCards(game.player, 1, { silent: true });
  const nonFatal =
    result?.ok === false &&
    result?.success === false &&
    result?.reason === "deck_empty" &&
    result?.nonFatal === true &&
    game.gameOver === false &&
    game.winner == null;
  game.dispose?.("smoke_deck_empty_draw");
  return {
    status: nonFatal ? "current_behavior" : "unexpected",
    detail: nonFatal
      ? "drawCards returns non-fatal deck_empty and leaves gameOver=false"
      : `unexpected draw result: ${compact(result)}, gameOver=${game.gameOver}`,
  };
}

async function smokePhaseSkip() {
  const nextGame = createSmokeGame().game;
  nextGame.phase = "main1";
  nextGame.turn = "player";
  nextGame.turnCounter = 2;
  const nextWindows = [];
  nextGame.checkAndOfferTraps = async (event, data = {}) => {
    if (event === "phase_end") {
      nextWindows.push(`${data.currentPhase}->${data.nextPhase}`);
    }
  };
  await nextGame.nextPhase();
  await nextGame.nextPhase();
  const nextFinalPhase = nextGame.phase;
  nextGame.dispose?.("smoke_phase_next");

  const skipGame = createSmokeGame().game;
  skipGame.phase = "main1";
  skipGame.turn = "player";
  skipGame.turnCounter = 2;
  const skipWindows = [];
  skipGame.checkAndOfferTraps = async (event, data = {}) => {
    if (event === "phase_end") {
      skipWindows.push(`${data.currentPhase}->${data.nextPhase}`);
    }
  };
  await skipGame.skipToPhase("main2");
  const skipFinalPhase = skipGame.phase;
  skipGame.dispose?.("smoke_phase_skip");

  const firstTurnGame = createSmokeGame().game;
  firstTurnGame.phase = "main1";
  firstTurnGame.turn = "player";
  firstTurnGame.turnCounter = 1;
  const firstTurnWindows = [];
  firstTurnGame.checkAndOfferTraps = async (event, data = {}) => {
    if (event === "phase_end") {
      firstTurnWindows.push(`${data.currentPhase}->${data.nextPhase}`);
    }
  };
  await firstTurnGame.skipToPhase("battle");
  const firstTurnFinalPhase = firstTurnGame.phase;
  firstTurnGame.dispose?.("smoke_phase_first_turn_battle_lock");

  const matchingWindows =
    nextWindows.join("|") === skipWindows.join("|") &&
    nextWindows.length === 2 &&
    nextFinalPhase === "main2" &&
    skipFinalPhase === "main2";
  const firstTurnLock =
    firstTurnFinalPhase === "main2" &&
    firstTurnWindows.join("|") === "main1->main2";

  return {
    status: matchingWindows && firstTurnLock ? "current_behavior" : "unexpected",
    detail:
      `nextPhase windows=${nextWindows.join(",") || "none"} final=${nextFinalPhase}; ` +
      `skipToPhase windows=${skipWindows.join(",") || "none"} final=${skipFinalPhase}; ` +
      `firstTurnBattle windows=${firstTurnWindows.join(",") || "none"} final=${firstTurnFinalPhase}`,
  };
}

async function smokeTrapFlipRollback() {
  const summarizeActivationResult = (result) =>
    result === undefined
      ? "undefined"
      : compact({
          success: result?.success === true,
          needsSelection: result?.needsSelection === true,
          reason: result?.reason || null,
          activationZone: result?.activationZone || null,
        });
  const createTrapScenario = (options = {}) => {
    const { game } = createSmokeGame({
      renderer: { confirmTrap: options.confirmTrap ?? true },
    });
    const trap = createCard(game, game.player, "Mirror Force", {
      isFacedown: true,
      turnSetOn: 0,
    });
    trap.turnSetOn = 0;
    trap.setTurn = 0;
    trap.isFacedown = true;
    game.player.spellTrap = [trap];
    game.phase = "main1";
    game.turn = "player";
    game.turnCounter = 2;
    game.effectEngine.canActivateSpellTrapEffectPreview = () => ({ ok: true });
    return { game, trap };
  };

  const failed = createTrapScenario();
  failed.game.effectEngine.activateSpellTrapEffect = async () => ({
    success: false,
    reason: "forced_smoke_failure",
  });
  const failedResult = await failed.game.tryActivateSpellTrapEffect(failed.trap);
  const failedOk =
    failedResult?.success === false &&
    failed.trap.isFacedown === true &&
    failed.trap.turnSetOn === 0 &&
    failed.trap.setTurn === 0 &&
    failed.game.player.spellTrap.includes(failed.trap);
  failed.game.dispose?.("smoke_trap_flip_rollback_failure");

  const preCancel = createTrapScenario({ confirmTrap: false });
  let preCancelActivated = false;
  preCancel.game.effectEngine.activateSpellTrapEffect = async () => {
    preCancelActivated = true;
    return { success: true };
  };
  const preCancelResult =
    await preCancel.game.tryActivateSpellTrapEffect(preCancel.trap);
  const preCancelOk =
    preCancel.trap.isFacedown === true &&
    preCancel.game.player.spellTrap.includes(preCancel.trap) &&
    preCancelActivated === false;
  preCancel.game.dispose?.("smoke_trap_flip_rollback_pre_cancel");

  const postCancel = createTrapScenario();
  const cancelTarget = createCard(
    postCancel.game,
    postCancel.game.bot,
    "Luminarch Celestial Marshal",
  );
  postCancel.game.bot.field = [cancelTarget];
  postCancel.game.effectEngine.activateSpellTrapEffect = async () => ({
    success: false,
    needsSelection: true,
    selectionContract: {
      requirements: [
        {
          id: "smoke_target",
          min: 1,
          max: 1,
          zones: ["field"],
          candidates: [
            {
              key: "smoke_target",
              cardRef: cancelTarget,
              zone: "field",
              controller: "bot",
            },
          ],
        },
      ],
      ui: { allowCancel: true, useFieldTargeting: false },
    },
  });
  const postCancelResult =
    await postCancel.game.tryActivateSpellTrapEffect(postCancel.trap);
  const postCancelSelectionStarted =
    postCancelResult?.needsSelection === true && !!postCancel.game.targetSelection;
  postCancel.game.cancelTargetSelection();
  const postCancelOk =
    postCancelSelectionStarted &&
    postCancel.trap.isFacedown === true &&
    postCancel.trap.turnSetOn === 0 &&
    postCancel.trap.setTurn === 0 &&
    postCancel.game.player.spellTrap.includes(postCancel.trap);
  postCancel.game.dispose?.("smoke_trap_flip_rollback_post_cancel");

  const success = createTrapScenario();
  success.game.effectEngine.activateSpellTrapEffect = async () => ({
    success: true,
  });
  const successResult =
    await success.game.tryActivateSpellTrapEffect(success.trap);
  const successOk =
    successResult?.success === true &&
    success.trap.isFacedown === false &&
    !success.game.player.spellTrap.includes(success.trap) &&
    success.game.player.graveyard.includes(success.trap);
  success.game.dispose?.("smoke_trap_flip_rollback_success");

  const allOk = failedOk && preCancelOk && postCancelOk && successOk;
  return {
    status: allOk ? "current_behavior" : "unexpected",
    detail:
      `failureRollback=${failedOk} result=${summarizeActivationResult(failedResult)}; ` +
      `preFlipCancel=${preCancelOk} result=${summarizeActivationResult(preCancelResult)}; ` +
      `postFlipCancel=${postCancelOk} result=${summarizeActivationResult(postCancelResult)}; ` +
      `successToGraveyard=${successOk} result=${summarizeActivationResult(successResult)}`,
  };
}

async function smokeQuickSpellFromHand() {
  const { game } = createSmokeGame();
  const quick = createCard(game, game.player, "Luminarch Holy Shield");
  const target = createCard(game, game.player, "Luminarch Celestial Marshal");
  game.player.hand = [quick];
  game.player.field = [target];
  game.phase = "battle";
  game.turn = "player";
  game.turnCounter = 2;

  const result = await game.tryActivateSpell(quick, 0, {
    holy_shield_targets: [{ owner: "player", zone: "field", index: 0 }],
  }, {
    owner: game.player,
    quickSpellContext: { legalWindow: true },
  });
  const activatedFromHand =
    result?.success === true &&
    !game.player.hand.includes(quick) &&
    !game.player.spellTrap.includes(quick) &&
    game.player.graveyard.includes(quick) &&
    target.tempBattleIndestructible === true &&
    target.battleDamageHealsControllerThisTurn === true;
  game.dispose?.("smoke_quick_spell_from_hand");
  return {
    status: activatedFromHand ? "current_behavior" : "unexpected",
    detail: activatedFromHand
      ? "quick spell activated from hand in battle window, resolved targets, and moved to graveyard"
      : `quick spell from-hand behavior differed: ${compact(result)}`,
  };
}

async function smokeQuickSpellSetActivation() {
  const selections = {
    holy_shield_targets: [{ owner: "player", zone: "field", index: 0 }],
  };
  const quickSpellContext = { legalWindow: true };
  const createSetQuickScenario = (options = {}) => {
    const { game } = createSmokeGame();
    const quick = createCard(game, game.player, "Luminarch Holy Shield");
    const target = createCard(
      game,
      game.player,
      "Luminarch Celestial Marshal",
    );
    quick.isFacedown = true;
    quick.turnSetOn = options.setTurn ?? 1;
    quick.setTurn = options.setTurn ?? 1;
    game.player.spellTrap = [quick];
    game.player.field = [target];
    game.phase = options.phase || "battle";
    game.turn = options.turn || "player";
    game.turnCounter = options.turnCounter ?? 3;
    return { game, quick, target };
  };

  const sameTurn = createSetQuickScenario({
    setTurn: 3,
    turnCounter: 3,
    phase: "main1",
  });
  const sameTurnResult = await sameTurn.game.tryActivateSpellTrapEffect(
    sameTurn.quick,
    selections,
    { owner: sameTurn.game.player, quickSpellContext },
  );
  const sameTurnBlocked =
    sameTurnResult?.ok === false && sameTurnResult?.code === "SET_THIS_TURN";
  sameTurn.game.dispose?.("smoke_quick_spell_set_same_turn");

  const ownTurn = createSetQuickScenario({
    phase: "battle",
    turn: "player",
  });
  const ownTurnResult = await ownTurn.game.tryActivateSpellTrapEffect(
    ownTurn.quick,
    selections,
    { owner: ownTurn.game.player, quickSpellContext },
  );
  const ownTurnOk =
    ownTurnResult?.success === true &&
    !ownTurn.game.player.spellTrap.includes(ownTurn.quick) &&
    ownTurn.game.player.graveyard.includes(ownTurn.quick) &&
    ownTurn.target.tempBattleIndestructible === true;
  ownTurn.game.dispose?.("smoke_quick_spell_set_own_turn");

  const opponentTurn = createSetQuickScenario({
    phase: "main1",
    turn: "bot",
  });
  const opponentTurnResult =
    await opponentTurn.game.tryActivateSpellTrapEffect(
      opponentTurn.quick,
      selections,
      { owner: opponentTurn.game.player, quickSpellContext },
    );
  const opponentTurnOk =
    opponentTurnResult?.success === true &&
    !opponentTurn.game.player.spellTrap.includes(opponentTurn.quick) &&
    opponentTurn.game.player.graveyard.includes(opponentTurn.quick) &&
    opponentTurn.target.tempBattleIndestructible === true;
  opponentTurn.game.dispose?.("smoke_quick_spell_set_opponent_turn");

  const failure = createSetQuickScenario({
    phase: "battle",
    turn: "player",
  });
  failure.game.effectEngine.activateSpellTrapEffect = async () => {
    failure.quick.isFacedown = false;
    return {
      success: false,
      needsSelection: false,
      reason: "forced_set_quick_failure_after_flip",
    };
  };
  const failureResult = await failure.game.tryActivateSpellTrapEffect(
    failure.quick,
    selections,
    { owner: failure.game.player, quickSpellContext },
  );
  const failureRollbackOk =
    failureResult?.success === false &&
    failure.quick.isFacedown === true &&
    failure.quick.turnSetOn === 1 &&
    failure.quick.setTurn === 1 &&
    failure.game.player.spellTrap.includes(failure.quick);
  failure.game.dispose?.("smoke_quick_spell_set_failure_rollback");

  const checks = {
    sameTurnBlocked,
    ownTurnOk,
    opponentTurnOk,
    failureRollbackOk,
  };
  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  return {
    status: failedChecks.length === 0 ? "current_behavior" : "unexpected",
    detail:
      failedChecks.length === 0
        ? "set Quick Spell blocks same-turn activation, resolves on either turn in legal windows, and rolls back after reveal failure"
        : `failed checks: ${failedChecks.join(", ")}; sameTurn=${compact(
            sameTurnResult,
          )}; ownTurn=${compact(ownTurnResult)}; opponentTurn=${compact(
            opponentTurnResult,
          )}; failure=${compact(failureResult)}`,
  };
}

async function smokeQuickSpellChainSystem() {
  const chainContext = {
    type: "card_activation",
    event: "card_activation",
  };
  const battleDamageContext = {
    type: "battle_damage",
    event: "battle_damage",
    isDamageStep: true,
  };
  const hasOption = (options, card, zone = null) =>
    options.some(
      (option) =>
        option?.card === card && (zone == null || option.zone === zone),
    );

  const createHandScenario = (options = {}) => {
    const { game } = createSmokeGame({ disableChains: false });
    const quick = createCard(game, game.player, "Luminarch Holy Shield");
    const target = createCard(
      game,
      game.player,
      "Luminarch Celestial Marshal",
    );
    game.player.hand = [quick];
    game.player.field = [target];
    game.phase = options.phase || "battle";
    game.turn = options.turn || "player";
    game.turnCounter = options.turnCounter ?? 3;
    return { game, quick, target };
  };

  const handOwnTurn = createHandScenario({ turn: "player" });
  const handOwnOptions =
    handOwnTurn.game.chainSystem.getActivatableCardsInChain(
      handOwnTurn.game.player,
      chainContext,
    );
  const handOwnTurnOk = hasOption(handOwnOptions, handOwnTurn.quick, "hand");
  handOwnTurn.game.dispose?.("smoke_chain_quick_hand_own_turn");

  const handOpponentTurn = createHandScenario({ turn: "bot" });
  const handOpponentOptions =
    handOpponentTurn.game.chainSystem.getActivatableCardsInChain(
      handOpponentTurn.game.player,
      chainContext,
    );
  const handOpponentBlocked = !hasOption(
    handOpponentOptions,
    handOpponentTurn.quick,
  );
  handOpponentTurn.game.dispose?.("smoke_chain_quick_hand_opponent_turn");

  const sameTurn = createHandScenario({ turn: "bot" });
  sameTurn.game.player.hand = [];
  sameTurn.quick.isFacedown = true;
  sameTurn.quick.turnSetOn = 3;
  sameTurn.quick.setTurn = 3;
  sameTurn.game.player.spellTrap = [sameTurn.quick];
  const sameTurnOptions =
    sameTurn.game.chainSystem.getActivatableCardsInChain(
      sameTurn.game.player,
      chainContext,
    );
  const setSameTurnBlocked = !hasOption(sameTurnOptions, sameTurn.quick);
  sameTurn.game.dispose?.("smoke_chain_quick_set_same_turn");

  const setPrevious = createHandScenario({ turn: "bot" });
  setPrevious.game.player.hand = [];
  setPrevious.quick.isFacedown = true;
  setPrevious.quick.turnSetOn = 1;
  setPrevious.quick.setTurn = 1;
  setPrevious.game.player.spellTrap = [setPrevious.quick];
  const setPreviousOptions =
    setPrevious.game.chainSystem.getActivatableCardsInChain(
      setPrevious.game.player,
      chainContext,
    );
  const setPreviousOk = hasOption(
    setPreviousOptions,
    setPrevious.quick,
    "spellTrap",
  );
  setPrevious.game.dispose?.("smoke_chain_quick_set_previous_turn");

  const speed3 = createHandScenario({ turn: "bot" });
  speed3.game.player.hand = [];
  speed3.quick.isFacedown = true;
  speed3.quick.turnSetOn = 1;
  speed3.quick.setTurn = 1;
  speed3.game.player.spellTrap = [speed3.quick];
  speed3.game.chainSystem.chainStack = [
    {
      card: { name: "Smoke Counter Trap", cardKind: "trap", subtype: "counter" },
      effect: { id: "smoke_counter", speed: 3 },
    },
  ];
  const speed3Options =
    speed3.game.chainSystem.getActivatableCardsInChain(
      speed3.game.player,
      chainContext,
    );
  const speed3Blocked = !hasOption(speed3Options, speed3.quick);
  speed3.game.dispose?.("smoke_chain_quick_speed3");

  const damageStep = createHandScenario({ turn: "player" });
  const damageStepOptions =
    damageStep.game.chainSystem.getActivatableCardsInChain(
      damageStep.game.player,
      battleDamageContext,
    );
  const holyDamageStepBlocked = !hasOption(
    damageStepOptions,
    damageStep.quick,
  );
  damageStep.game.dispose?.("smoke_chain_quick_damage_step_block");

  const synthetic = createSmokeGame({ disableChains: false });
  synthetic.game.phase = "battle";
  synthetic.game.turn = "player";
  synthetic.game.turnCounter = 3;
  const syntheticQuick = {
    id: 999001,
    name: "Smoke Quick Stat Boost",
    cardKind: "spell",
    subtype: "quick-play",
    owner: "player",
    controller: "player",
    effects: [
      {
        id: "smoke_quick_stat_boost",
        timing: "on_play",
        speed: 2,
        actions: [
          {
            type: "buff_stats_temp",
            targetRef: "self",
            atkBoost: 500,
            defBoost: 0,
          },
        ],
      },
    ],
  };
  synthetic.game.player.hand = [syntheticQuick];
  const syntheticOptions =
    synthetic.game.chainSystem.getActivatableCardsInChain(
      synthetic.game.player,
      battleDamageContext,
    );
  const syntheticDamageStepAllowed = hasOption(
    syntheticOptions,
    syntheticQuick,
    "hand",
  );
  synthetic.game.dispose?.("smoke_chain_quick_damage_step_allow");

  const resolution = createHandScenario({ turn: "player" });
  resolution.game.chainSystem.addToChain(
    resolution.quick,
    resolution.game.player,
    resolution.quick.effects?.[0],
    chainContext,
    { holy_shield_targets: [resolution.target] },
    "hand",
  );
  await resolution.game.chainSystem.resolveChain();
  const handResolutionOk =
    !resolution.game.player.hand.includes(resolution.quick) &&
    !resolution.game.player.spellTrap.includes(resolution.quick) &&
    resolution.game.player.graveyard.includes(resolution.quick) &&
    resolution.target.tempBattleIndestructible === true &&
    resolution.target.battleDamageHealsControllerThisTurn === true;
  resolution.game.dispose?.("smoke_chain_quick_hand_resolution");

  const checks = {
    handOwnTurnOk,
    handOpponentBlocked,
    setSameTurnBlocked,
    setPreviousOk,
    speed3Blocked,
    holyDamageStepBlocked,
    syntheticDamageStepAllowed,
    handResolutionOk,
  };
  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  return {
    status: failedChecks.length === 0 ? "current_behavior" : "unexpected",
    detail:
      failedChecks.length === 0
        ? "ChainSystem discovers Quick Spells by central rules, blocks Speed 3/Damage Step cases, and resolves hand Quick Spell to graveyard"
        : `failed checks: ${failedChecks.join(", ")}`,
  };
}

function installOpenStateRecorder(game) {
  const opened = [];
  game.chainSystem = {
    isChainResolving: () => false,
    isChainWindowOpen: () => false,
    getActivatableCardsInChain: () => [
      {
        card: { name: "Smoke Open-State Response" },
        effect: { id: "smoke_open_state_response" },
        zone: "spellTrap",
      },
    ],
    async openChainWindow(context) {
      opened.push({
        event: context?.event || null,
        type: context?.type || null,
        currentPhase: context?.currentPhase || null,
        nextPhase: context?.nextPhase || null,
        fromPhase: context?.fromPhase || null,
        toPhase: context?.toPhase || null,
        battleStep: context?.battleStep || null,
        damageStepTiming: context?.damageStepTiming || null,
        isDamageStep: context?.isDamageStep === true,
        openState: context?.openState === true,
        legalWindow: context?.legalWindow === true,
      });
    },
  };
  return opened;
}

async function smokeQuickSpellOpenStateWindows() {
  const hasContext = (opened, matcher) => opened.some(matcher);

  const turnGame = createSmokeGame({ disableChains: false }).game;
  const turnOpened = installOpenStateRecorder(turnGame);
  turnGame.player.deck = [
    createCard(turnGame, turnGame.player, "Luminarch Celestial Marshal"),
  ];
  turnGame.turn = "player";
  await turnGame.startTurn();
  const drawStandbyOk =
    hasContext(
      turnOpened,
      (ctx) =>
        ctx.event === "phase_end" &&
        ctx.currentPhase === "draw" &&
        ctx.toPhase === "standby",
    ) &&
    hasContext(
      turnOpened,
      (ctx) =>
        ctx.event === "phase_start" &&
        ctx.currentPhase === "standby" &&
        ctx.openState &&
        ctx.legalWindow,
    ) &&
    hasContext(
      turnOpened,
      (ctx) =>
        ctx.event === "phase_end" &&
        ctx.currentPhase === "standby" &&
        ctx.toPhase === "main1",
    );
  turnGame.dispose?.("smoke_quick_open_state_turn");

  const phaseGame = createSmokeGame({ disableChains: false }).game;
  const phaseOpened = installOpenStateRecorder(phaseGame);
  phaseGame.phase = "main1";
  phaseGame.turn = "player";
  phaseGame.turnCounter = 2;
  await phaseGame.nextPhase();
  const battlePhaseStateAfterStart = phaseGame.battleStep;
  await phaseGame.nextPhase();
  const battlePhaseStateAfterEnd = phaseGame.battleStep;
  const battlePhaseOk =
    hasContext(
      phaseOpened,
      (ctx) =>
        ctx.event === "phase_start" &&
        ctx.currentPhase === "battle" &&
        ctx.battleStep === "start",
    ) &&
    battlePhaseStateAfterStart === "battle" &&
    hasContext(
      phaseOpened,
      (ctx) =>
        ctx.event === "phase_end" &&
        ctx.currentPhase === "battle" &&
        ctx.toPhase === "main2" &&
        ctx.battleStep === "end",
    ) &&
    battlePhaseStateAfterEnd === null;
  phaseGame.dispose?.("smoke_quick_open_state_phase");

  const eventGame = createSmokeGame({ disableChains: false }).game;
  const eventOpened = installOpenStateRecorder(eventGame);
  eventGame.phase = "battle";
  eventGame.turn = "player";
  eventGame.turnCounter = 3;
  eventGame.battleStep = "battle";
  const attacker = createCard(
    eventGame,
    eventGame.player,
    "Luminarch Celestial Marshal",
  );
  const defender = createCard(
    eventGame,
    eventGame.bot,
    "Luminarch Celestial Marshal",
  );
  eventGame.player.field = [attacker];
  eventGame.bot.field = [defender];
  await eventGame.emit("after_summon", {
    card: attacker,
    player: eventGame.player,
    method: "normal",
    fromZone: "hand",
  });
  await eventGame.emit("attack_declared", {
    attacker,
    defender,
    target: defender,
    attackerOwner: eventGame.player,
    defenderOwner: eventGame.bot,
    targetOwner: eventGame.bot,
    battleStep: "battle",
  });
  eventGame.battleStep = "damage";
  eventGame.damageStepTiming = "before_damage_calculation";
  await eventGame.emit("battle_damage", {
    attacker,
    defender,
    target: defender,
    attackerOwner: eventGame.player,
    defenderOwner: eventGame.bot,
    targetOwner: eventGame.bot,
    battleStep: eventGame.battleStep,
    damageStepTiming: eventGame.damageStepTiming,
    isDamageStep: true,
  });
  eventGame.battleStep = "battle";
  eventGame.damageStepTiming = null;
  await eventGame.emit("effect_activated", {
    card: attacker,
    player: eventGame.player,
    effect: { id: "smoke_monster_effect" },
    activationZone: "field",
    effectType: "monsterEffect",
  });
  const eventWindowsOk =
    hasContext(eventOpened, (ctx) => ctx.type === "summon") &&
    hasContext(
      eventOpened,
      (ctx) =>
        ctx.type === "attack_declaration" && ctx.battleStep === "battle",
    ) &&
    hasContext(
      eventOpened,
      (ctx) =>
        ctx.type === "battle_damage" &&
        ctx.isDamageStep &&
        ctx.damageStepTiming === "before_damage_calculation",
    ) &&
    hasContext(eventOpened, (ctx) => ctx.type === "effect_activation");
  eventGame.dispose?.("smoke_quick_open_state_events");

  const checks = {
    drawStandbyOk,
    battlePhaseOk,
    eventWindowsOk,
  };
  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  return {
    status: failedChecks.length === 0 ? "current_behavior" : "unexpected",
    detail:
      failedChecks.length === 0
        ? "open-state windows cover Draw/Standby, Battle start/end, summon, attack declaration, Damage Step, and monster effect activation"
        : `failed checks: ${failedChecks.join(", ")}; turn=${compact(
            turnOpened,
          )}; phase=${compact(phaseOpened)}; events=${compact(eventOpened)}`,
  };
}

async function smokeDamageStepActivationRules() {
  const damageStepContext = {
    type: "battle_damage",
    event: "battle_damage",
    isDamageStep: true,
    damageStepTiming: "before_damage_calculation",
    legalWindow: true,
  };
  const attackDeclarationContext = {
    type: "attack_declaration",
    event: "attack_declared",
    legalWindow: true,
  };
  const hasOption = (options, card, zone = null) =>
    options.some(
      (option) =>
        option?.card === card && (zone == null || option.zone === zone),
    );

  const { game } = createSmokeGame({ disableChains: false });
  game.phase = "battle";
  game.turn = "player";
  game.turnCounter = 3;

  const holy = createCard(game, game.player, "Luminarch Holy Shield");
  const vanishing = createCard(game, game.player, "Miragebound Vanishing Step");
  const magicSickle = createCard(game, game.player, "Luminarch Magic Sickle");
  const rotStag = createCard(game, game.player, "Bloomrot Rot-Stag");
  const magicSickleEffect = magicSickle.effects?.find(
    (effect) => effect?.id === "luminarch_magic_sickle_damage_boost",
  );
  const rotStagEffect = rotStag.effects?.find(
    (effect) => effect?.id === "bloomrot_rot_stag_attack_spore_boost",
  );

  const counterTrap = {
    name: "Smoke Counter Trap",
    cardKind: "trap",
    subtype: "counter",
    effects: [{ actions: [{ type: "destroy" }] }],
  };
  const directTrapEffect = {
    id: "smoke_damage_step_direct_trap",
    timing: "on_activate",
    speed: 2,
    actions: [
      {
        type: "buff_stats_temp",
        targetRef: "self",
        atkBoost: 500,
        defBoost: 0,
      },
    ],
  };
  const destroyTrapEffect = {
    id: "smoke_damage_step_destroy_trap",
    timing: "on_activate",
    speed: 2,
    actions: [{ type: "destroy", targetRef: "self" }],
  };
  const directTrap = {
    id: 999101,
    name: "Smoke Direct Stat Trap",
    cardKind: "trap",
    subtype: "normal",
    owner: "player",
    controller: "player",
    isFacedown: true,
    turnSetOn: 1,
    setTurn: 1,
    effects: [directTrapEffect],
  };
  const destroyTrap = {
    id: 999102,
    name: "Smoke Destroy Trap",
    cardKind: "trap",
    subtype: "normal",
    owner: "player",
    controller: "player",
    isFacedown: true,
    turnSetOn: 1,
    setTurn: 1,
    effects: [destroyTrapEffect],
  };
  const directQuickMonsterEffect = {
    id: "smoke_damage_step_direct_quick_monster",
    timing: "ignition",
    speed: 2,
    isQuickEffect: true,
    actions: [
      {
        type: "buff_stats_temp",
        targetRef: "self",
        atkBoost: 300,
        defBoost: 0,
      },
    ],
  };
  const destroyQuickMonsterEffect = {
    id: "smoke_damage_step_destroy_quick_monster",
    timing: "ignition",
    speed: 2,
    isQuickEffect: true,
    actions: [{ type: "destroy", targetRef: "self" }],
  };
  const directQuickMonster = {
    id: 999103,
    name: "Smoke Direct Quick Monster",
    cardKind: "monster",
    owner: "player",
    controller: "player",
    atk: 1000,
    def: 1000,
    position: "attack",
    isFacedown: false,
    effects: [directQuickMonsterEffect],
  };
  const destroyQuickMonster = {
    id: 999104,
    name: "Smoke Destroy Quick Monster",
    cardKind: "monster",
    owner: "player",
    controller: "player",
    atk: 1000,
    def: 1000,
    position: "attack",
    isFacedown: false,
    effects: [destroyQuickMonsterEffect],
  };

  const helperChecks = {
    counterTrapAllowed: canActivateDuringDamageStep(
      counterTrap.effects[0],
      counterTrap,
      damageStepContext,
    ).ok,
    directTrapAllowed: canActivateDuringDamageStep(
      directTrapEffect,
      directTrap,
      damageStepContext,
    ).ok,
    destroyTrapBlocked:
      canActivateDuringDamageStep(
        destroyTrapEffect,
        destroyTrap,
        damageStepContext,
      ).ok === false,
    holyDamageStepBlocked:
      canActivateDuringDamageStep(
        holy.effects?.[0],
        holy,
        damageStepContext,
      ).ok === false,
    vanishingDamageStepBlocked:
      canActivateDuringDamageStep(
        vanishing.effects?.[0],
        vanishing,
        damageStepContext,
      ).ok === false,
    vanishingAttackDeclarationAllowed: canActivateDuringDamageStep(
      vanishing.effects?.[0],
      vanishing,
      attackDeclarationContext,
    ).ok,
    magicSickleAllowed: canActivateDuringDamageStep(
      magicSickleEffect,
      magicSickle,
      damageStepContext,
    ).ok,
    rotStagBattleDamageTriggerAllowed: canActivateDuringDamageStep(
      rotStagEffect,
      rotStag,
      damageStepContext,
    ).ok,
  };

  game.player.spellTrap = [directTrap, destroyTrap];
  game.player.field = [directQuickMonster, destroyQuickMonster];
  const chainOptions = game.chainSystem.getActivatableCardsInChain(
    game.player,
    damageStepContext,
  );
  const chainChecks = {
    chainDirectTrapAllowed: hasOption(chainOptions, directTrap, "spellTrap"),
    chainDestroyTrapBlocked: !hasOption(chainOptions, destroyTrap),
    chainDirectQuickMonsterAllowed: hasOption(
      chainOptions,
      directQuickMonster,
      "field",
    ),
    chainDestroyQuickMonsterBlocked: !hasOption(
      chainOptions,
      destroyQuickMonster,
    ),
  };
  game.dispose?.("smoke_damage_step_chain_rules");

  const collectorGame = createSmokeGame().game;
  collectorGame.phase = "battle";
  collectorGame.turn = "player";
  collectorGame.turnCounter = 3;
  const collectorSickle = createCard(
    collectorGame,
    collectorGame.player,
    "Luminarch Magic Sickle",
  );
  const collectorAttacker = createCard(
    collectorGame,
    collectorGame.player,
    "Luminarch Celestial Marshal",
  );
  const collectorDefender = createCard(
    collectorGame,
    collectorGame.bot,
    "Luminarch Celestial Marshal",
  );
  collectorGame.player.hand = [collectorSickle];
  collectorGame.player.field = [collectorAttacker];
  collectorGame.bot.field = [collectorDefender];
  const triggerPackage =
    await collectorGame.effectEngine.collectBattleDamageTriggers({
      attacker: collectorAttacker,
      defender: collectorDefender,
      target: collectorDefender,
      attackerOwner: collectorGame.player,
      defenderOwner: collectorGame.bot,
      targetOwner: collectorGame.bot,
      isDamageStep: true,
      damageStepTiming: "before_damage_calculation",
    });
  const magicSickleCollected =
    Array.isArray(triggerPackage?.entries) &&
    triggerPackage.entries.some(
      (entry) => entry?.effect?.id === "luminarch_magic_sickle_damage_boost",
    );
  collectorGame.dispose?.("smoke_damage_step_trigger_collector");

  const checks = {
    ...helperChecks,
    ...chainChecks,
    magicSickleCollected,
  };
  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  return {
    status: failedChecks.length === 0 ? "current_behavior" : "unexpected",
    detail:
      failedChecks.length === 0
        ? "Damage Step filter allows Counter Traps and direct ATK/DEF changes, blocks non-stat effects, and preserves Magic Sickle"
        : `failed checks: ${failedChecks.join(", ")}; chainOptions=${compact(
            chainOptions.map((option) => ({
              card: option?.card?.name,
              zone: option?.zone,
            })),
          )}; collectorEntries=${compact(
            (triggerPackage?.entries || []).map((entry) => entry?.effect?.id),
          )}`,
  };
}

async function smokeQuickSpellRulesHelper() {
  const { game } = createSmokeGame();
  game.phase = "main1";
  game.turn = "player";
  game.turnCounter = 2;

  const holy = createCard(game, game.player, "Luminarch Holy Shield");
  const vanishing = createCard(game, game.player, "Miragebound Vanishing Step");
  const normalSpell = createCard(game, game.player, "Miragebound Heat Haze");
  game.player.hand = [holy, vanishing, normalSpell];

  const recognition =
    isQuickSpell(holy) &&
    isQuickSpell(vanishing) &&
    !isQuickSpell(normalSpell) &&
    getQuickSpellActivationZone(holy, game.player) === "hand";

  const handOwnTurn = canActivateQuickSpellFromHand(
    game,
    holy,
    game.player,
    { effect: holy.effects?.[0] },
  );

  game.turn = "bot";
  const handOpponentTurn = canActivateQuickSpellFromHand(
    game,
    holy,
    game.player,
    { legalWindow: true, effect: holy.effects?.[0] },
  );

  const setSameTurn = createCard(game, game.player, "Luminarch Holy Shield");
  setSameTurn.isFacedown = true;
  setSameTurn.turnSetOn = 2;
  setSameTurn.setTurn = 2;
  game.player.spellTrap = [setSameTurn];
  const setSameTurnBlocked = canActivateSetQuickSpell(
    game,
    setSameTurn,
    game.player,
    { legalWindow: true, effect: setSameTurn.effects?.[0] },
  );

  const setPreviousTurn = createCard(
    game,
    game.player,
    "Luminarch Holy Shield",
  );
  setPreviousTurn.isFacedown = true;
  setPreviousTurn.turnSetOn = 1;
  setPreviousTurn.setTurn = 1;
  game.player.spellTrap = [setPreviousTurn];
  const setPreviousOpponentTurn = canActivateSetQuickSpell(
    game,
    setPreviousTurn,
    game.player,
    { legalWindow: true, effect: setPreviousTurn.effects?.[0] },
  );
  const genericSetPrevious = canActivateQuickSpell(
    game,
    setPreviousTurn,
    game.player,
    { legalWindow: true, effect: setPreviousTurn.effects?.[0] },
  );

  game.turn = "player";
  const speed3Blocked = canActivateQuickSpellFromHand(
    game,
    holy,
    game.player,
    {
      legalWindow: true,
      requiredSpellSpeed: 3,
      effect: holy.effects?.[0],
    },
  );

  const holyDamageStep = canActivateInDamageStep(holy.effects?.[0], holy, {
    type: "battle_damage",
  });
  const vanishingDamageStep = canActivateInDamageStep(
    vanishing.effects?.[0],
    vanishing,
    { type: "battle_damage" },
  );
  const syntheticBuffEffect = {
    actions: [
      {
        type: "buff_stats_temp",
        targetRef: "self",
        atkBoost: 500,
        defBoost: 0,
      },
    ],
  };
  const syntheticDamageStep = canActivateInDamageStep(
    syntheticBuffEffect,
    { cardKind: "spell", subtype: "quick" },
    { type: "battle_damage" },
  );

  const checks = {
    recognition,
    handOwnTurn: handOwnTurn.ok === true,
    handOpponentTurnBlocked:
      handOpponentTurn.ok === false &&
      handOpponentTurn.code === "OPPONENT_TURN_HAND",
    setSameTurnBlocked:
      setSameTurnBlocked.ok === false &&
      setSameTurnBlocked.code === "SET_THIS_TURN",
    setPreviousOpponentTurn: setPreviousOpponentTurn.ok === true,
    genericSetPrevious: genericSetPrevious.ok === true,
    speed3Blocked:
      speed3Blocked.ok === false &&
      speed3Blocked.code === "QUICK_SPELL_SPEED_TOO_LOW",
    holyDamageStepBlocked:
      holyDamageStep.ok === false &&
      holyDamageStep.code === "DAMAGE_STEP_RESTRICTED",
    vanishingDamageStepBlocked:
      vanishingDamageStep.ok === false &&
      vanishingDamageStep.code === "DAMAGE_STEP_RESTRICTED",
    syntheticDamageStepAllowed:
      syntheticDamageStep.ok === true &&
      effectDirectlyChangesAtkDef(syntheticBuffEffect) === true,
  };

  game.dispose?.("smoke_quick_spell_rules_helper");
  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  return {
    status: failedChecks.length === 0 ? "current_behavior" : "unexpected",
    detail:
      failedChecks.length === 0
        ? "Quick Spell helper recognizes zones, hand/set rules, speed 3 block, and Damage Step ATK/DEF filter"
        : `failed checks: ${failedChecks.join(", ")}`,
  };
}

async function smokeBattleIndestructible() {
  const { game } = createSmokeGame();
  const marshal = createCard(game, game.player, "Luminarch Celestial Marshal");
  game.player.field = [marshal];
  game.bot.deck = [createCard(game, game.bot, "Mirror Force")];
  game.turn = "player";
  game.turnCounter = 1;

  const firstCanDestroy = game.canDestroyByBattle(marshal);
  const secondSameTurnCanDestroy = game.canDestroyByBattle(marshal);
  game.turn = "bot";
  await game.startTurn();
  const nextTurnCanDestroy = game.canDestroyByBattle(marshal);
  const secondNextTurnCanDestroy = game.canDestroyByBattle(marshal);

  const tempProtected = createCard(game, game.player, "Luminarch Celestial Marshal");
  tempProtected.tempBattleIndestructible = true;
  tempProtected.battleIndestructibleOncePerTurnLastUsedTurn = null;
  const tempCanDestroy = game.canDestroyByBattle(tempProtected);
  const tempConsumedTurn =
    tempProtected.battleIndestructibleOncePerTurnLastUsedTurn;
  tempProtected.tempBattleIndestructible = false;
  const tempAfterClearedCanDestroy = game.canDestroyByBattle(tempProtected);

  const permanentProtected = createCard(
    game,
    game.player,
    "Luminarch Celestial Marshal",
  );
  permanentProtected.battleIndestructible = true;
  permanentProtected.battleIndestructibleOncePerTurnLastUsedTurn = null;
  const permanentCanDestroy = game.canDestroyByBattle(permanentProtected);
  const permanentConsumedTurn =
    permanentProtected.battleIndestructibleOncePerTurnLastUsedTurn;

  const checks = {
    firstUseBlocks: firstCanDestroy === false,
    secondSameTurnAllows: secondSameTurnCanDestroy === true,
    nextTurnBlocksAgain: nextTurnCanDestroy === false,
    secondNextTurnAllows: secondNextTurnCanDestroy === true,
    tempDoesNotConsume:
      tempCanDestroy === false &&
      tempConsumedTurn === null &&
      tempAfterClearedCanDestroy === false &&
      tempProtected.battleIndestructibleOncePerTurnLastUsedTurn ===
        game.turnCounter,
    permanentDoesNotConsume:
      permanentCanDestroy === false && permanentConsumedTurn === null,
  };

  game.dispose?.("smoke_battle_indestructible");

  const failedChecks = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  return {
    status: failedChecks.length === 0 ? "current_behavior" : "unexpected",
    detail:
      failedChecks.length === 0
        ? `turn A first=${firstCanDestroy}, second=${secondSameTurnCanDestroy}; turn B first=${nextTurnCanDestroy}, second=${secondNextTurnCanDestroy}; temp/permanent did not consume`
        : `failed checks: ${failedChecks.join(", ")}`,
  };
}

async function smokeUpdateBoardMutation() {
  const { game, renderer } = createSmokeGame();
  const card = createCard(game, game.player, "Luminarch Celestial Marshal");
  const devLogs = [];
  const renderedFields = [];
  const consoleErrors = [];
  game.setDevMode(true);
  game.devLog = (tag, detail) => {
    devLogs.push({ tag, detail });
  };
  renderer.renderField = (player) => {
    renderedFields.push({
      playerId: player.id,
      length: Array.isArray(player.field) ? player.field.length : null,
      hasNullish:
        Array.isArray(player.field) && player.field.some((item) => item == null),
    });
  };
  game.player.field = [undefined, card];
  const before = game.player.field.length;
  const originalConsoleError = console.error;
  console.error = (...args) => {
    consoleErrors.push(args);
  };
  try {
    game.updateBoard();
  } finally {
    console.error = originalConsoleError;
  }
  const after = game.player.field.length;
  const inspection = game.inspectZoneNullishCards("smoke_update_board_after", {
    zones: ["field"],
  });
  const renderedPlayerField = renderedFields.find(
    (entry) => entry.playerId === "player",
  );
  const loggedNullish = devLogs.some(
    (entry) =>
      entry.tag === "ZONE_NULLISH_RENDER" &&
      entry.detail?.issues?.some(
        (issue) =>
          issue.playerId === "player" &&
          issue.zone === "field" &&
          issue.indices?.includes(0),
      ),
  );
  const loggedConsoleError = consoleErrors.some((args) =>
    String(args[0] || "").includes("Nullish zone slots detected"),
  );
  game.dispose?.("smoke_update_board_mutation");
  const currentBehavior =
    before === 2 &&
    after === 2 &&
    inspection.ok === false &&
    renderedPlayerField?.length === 1 &&
    renderedPlayerField?.hasNullish === false &&
    loggedNullish &&
    loggedConsoleError;
  return {
    status: currentBehavior ? "current_behavior" : "unexpected",
    detail: currentBehavior
      ? "updateBoard preserved corrupt zone state, rendered a sanitized view, and logged nullish field slot"
      : `before=${before}; after=${after}; inspection=${compact(
          inspection,
        )}; rendered=${compact(
          renderedPlayerField,
        )}; logged=${loggedNullish}; consoleError=${loggedConsoleError}`,
  };
}

async function smokeReturnContracts() {
  const { game } = createSmokeGame();
  const monsterResult = await game.tryActivateMonsterEffect(null);
  const spellTrapResult = await game.tryActivateSpellTrapEffect(null);
  const spellResult = await game.tryActivateSpell(null, -1);
  const fieldSpellResult = await game.activateFieldSpellEffect(null);
  const pipelineResult = await game.runActivationPipeline({});
  game.dispose?.("smoke_return_contracts");

  const cancelScenario = createSmokeGame({ renderer: { confirmTrap: false } });
  const cancelTrap = createCard(
    cancelScenario.game,
    cancelScenario.game.player,
    "Mirror Force",
    {
      isFacedown: true,
      turnSetOn: 0,
    },
  );
  cancelTrap.turnSetOn = 0;
  cancelTrap.setTurn = 0;
  cancelTrap.isFacedown = true;
  cancelScenario.game.player.spellTrap = [cancelTrap];
  cancelScenario.game.phase = "main1";
  cancelScenario.game.turn = "player";
  cancelScenario.game.turnCounter = 2;
  cancelScenario.game.effectEngine.canActivateSpellTrapEffectPreview = () => ({
    ok: true,
  });
  const cancelResult =
    await cancelScenario.game.tryActivateSpellTrapEffect(cancelTrap);
  const cancelPreservedSet =
    cancelTrap.isFacedown === true &&
    cancelScenario.game.player.spellTrap.includes(cancelTrap);
  cancelScenario.game.dispose?.("smoke_return_contracts_cancel");

  const invalidResults = {
    monsterResult,
    spellTrapResult,
    spellResult,
    fieldSpellResult,
    pipelineResult,
  };
  const invalidContractsOk = Object.values(invalidResults).every(
    (result) =>
      result &&
      typeof result === "object" &&
      result.success === false &&
      result.ok === false &&
      result.needsSelection === false &&
      typeof result.code === "string",
  );
  const cancelContractOk =
    cancelResult?.success === false &&
    cancelResult?.ok === false &&
    cancelResult?.cancelled === true &&
    cancelResult?.reason === "cancelled" &&
    cancelResult?.code === "CANCELLED" &&
    cancelPreservedSet;
  return {
    status:
      invalidContractsOk && cancelContractOk ? "current_behavior" : "unexpected",
    detail:
      invalidContractsOk && cancelContractOk
        ? "invalid public actions return stable failure contracts and trap modal cancellation is distinguishable"
        : `invalid=${compact(invalidResults)}; cancel=${compact(
            cancelResult,
          )}; cancelPreservedSet=${cancelPreservedSet}`,
  };
}

async function smokeLegacyGenericCards() {
  const callScenario = createSmokeGame();
  const call = createCard(
    callScenario.game,
    callScenario.game.player,
    "Call of the Haunted",
  );
  const hauntedTarget = createCard(
    callScenario.game,
    callScenario.game.player,
    "Arcane Scholar",
  );
  callScenario.game.player.spellTrap = [call];
  callScenario.game.player.graveyard = [hauntedTarget];
  callScenario.game.phase = "main1";
  callScenario.game.turn = "player";
  callScenario.game.turnCounter = 2;
  const callResult =
    await callScenario.game.effectEngine.activateSpellTrapEffect(
      call,
      callScenario.game.player,
      { haunted_target: [{ owner: "player", zone: "graveyard", index: 0 }] },
      "spellTrap",
      { committed: true },
    );
  const callOk =
    callResult?.success === true &&
    hauntedTarget.position === "attack" &&
    callScenario.game.player.field.includes(hauntedTarget) &&
    call.boundMonsterTarget === hauntedTarget &&
    hauntedTarget.boundTrapSource === call;
  callScenario.game.dispose?.("smoke_legacy_call_of_the_haunted");

  const swordScenario = createSmokeGame();
  const sword = createCard(
    swordScenario.game,
    swordScenario.game.player,
    "Light-Dividing Sword",
  );
  const swordHost = createCard(
    swordScenario.game,
    swordScenario.game.player,
    "Nightmare Steed",
  );
  const swordVictim = createCard(
    swordScenario.game,
    swordScenario.game.bot,
    "Arcane Scholar",
  );
  sword.equippedTo = swordHost;
  swordHost.equips = [sword];
  swordScenario.game.player.spellTrap = [sword];
  swordScenario.game.player.field = [swordHost];
  swordScenario.game.bot.field = [swordVictim];
  swordScenario.game.player.lp = 4000;
  await swordScenario.game.applyBattleDestroyEffect(swordHost, swordVictim);
  const swordOk = swordScenario.game.player.lp === 4500;
  swordScenario.game.dispose?.("smoke_legacy_light_dividing_sword");

  const steedScenario = createSmokeGame();
  const steed = createCard(
    steedScenario.game,
    steedScenario.game.player,
    "Midnight Nightmare Steed",
  );
  const steedVictim = createCard(
    steedScenario.game,
    steedScenario.game.bot,
    "Arcane Scholar",
  );
  steedScenario.game.player.field = [steed];
  steedScenario.game.bot.field = [steedVictim];
  steedScenario.game.bot.lp = 4000;
  await steedScenario.game.applyBattleDestroyEffect(steed, steedVictim);
  const steedOk = steedScenario.game.bot.lp === 3700;
  steedScenario.game.dispose?.("smoke_legacy_midnight_steed");

  const rebornScenario = createSmokeGame();
  const reborn = createCard(
    rebornScenario.game,
    rebornScenario.game.player,
    "Monster Reborn",
  );
  const rebornTarget = createCard(
    rebornScenario.game,
    rebornScenario.game.bot,
    "Arcane Scholar",
  );
  rebornScenario.game.player.hand = [reborn];
  rebornScenario.game.bot.graveyard = [rebornTarget];
  rebornScenario.game.phase = "main1";
  rebornScenario.game.turn = "player";
  rebornScenario.game.turnCounter = 2;
  const rebornResult =
    await rebornScenario.game.effectEngine.activateSpellTrapEffect(
      reborn,
      rebornScenario.game.player,
      { reborn_target: [{ owner: "bot", zone: "graveyard", index: 0 }] },
      "hand",
      { fromHand: true, committed: true },
    );
  const rebornOk =
    rebornResult?.success === true &&
    rebornScenario.game.player.field.includes(rebornTarget) &&
    !rebornScenario.game.bot.graveyard.includes(rebornTarget) &&
    rebornTarget.owner === "player";
  rebornScenario.game.dispose?.("smoke_legacy_monster_reborn");

  const allOk = callOk && swordOk && steedOk && rebornOk;
  return {
    status: allOk ? "current_behavior" : "unexpected",
    detail:
      `callAttackBind=${callOk}; ` +
      `lightDividingHeal=${swordOk}; ` +
      `midnightDamage=${steedOk}; ` +
      `monsterRebornAwaitedMove=${rebornOk}`,
  };
}

const scenarios = [
  ["Reset reuse", smokeResetReuse],
  ["Deck empty draw", smokeDeckEmptyDraw],
  ["Phase skip", smokePhaseSkip],
  ["Trap flip rollback", smokeTrapFlipRollback],
  ["Quick Spell rules helper", smokeQuickSpellRulesHelper],
  ["Quick Spell from hand", smokeQuickSpellFromHand],
  ["Quick Spell set activation", smokeQuickSpellSetActivation],
  ["Quick Spell chain system", smokeQuickSpellChainSystem],
  ["Quick Spell open-state windows", smokeQuickSpellOpenStateWindows],
  ["Damage Step activation rules", smokeDamageStepActivationRules],
  ["Battle indestructible", smokeBattleIndestructible],
  ["updateBoard mutation", smokeUpdateBoardMutation],
  ["Return contracts", smokeReturnContracts],
  ["Legacy generic cards", smokeLegacyGenericCards],
];

async function runScenario(name, fn) {
  try {
    const result = await fn();
    return {
      scenario: name,
      status: result?.status || "blocked",
      detail: result?.detail || "no detail returned",
    };
  } catch (error) {
    return {
      scenario: name,
      status: "blocked",
      detail: error?.stack || error?.message || String(error),
    };
  }
}

function printTable(rows) {
  const sorted = [...rows].sort((a, b) => {
    const statusDiff =
      (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    return statusDiff || a.scenario.localeCompare(b.scenario);
  });
  const columns = ["scenario", "status", "detail"];
  const widths = Object.fromEntries(
    columns.map((column) => [
      column,
      Math.max(
        column.length,
        ...sorted.map((row) => String(row[column] || "").length),
      ),
    ]),
  );
  const line = columns
    .map((column) => "-".repeat(widths[column]))
    .join("-+-");
  const header = columns
    .map((column) => column.padEnd(widths[column]))
    .join(" | ");

  console.log(header);
  console.log(line);
  for (const row of sorted) {
    console.log(
      columns
        .map((column) => String(row[column] || "").padEnd(widths[column]))
        .join(" | "),
    );
  }
}

async function main() {
  if (SMOKE_MAIN_DECK_IDS.length < 4) {
    throw new Error("Smoke harness could not find enough main deck cards.");
  }
  if (!cardDatabaseByName.has("Luminarch Holy Shield")) {
    throw new Error("Smoke harness requires Luminarch Holy Shield.");
  }

  const originalConsole = {
    log: console.log,
    warn: console.warn,
  };
  const captured = [];
  if (!verbose && !jsonOutput) {
    console.log = (...items) => captured.push(["log", items]);
    console.warn = (...items) => captured.push(["warn", items]);
  }

  let rows;
  try {
    rows = [];
    for (const [name, fn] of scenarios) {
      rows.push(await runScenario(name, fn));
    }
  } finally {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ rows, capturedLogCount: captured.length }, null, 2));
    return;
  }

  console.log("\nShadow Duel Game bug smoke report");
  console.log(`Captured internal log/warn calls: ${captured.length}`);
  printTable(rows);
}

main().catch((error) => {
  console.error("[run_game_bug_smokes] Infrastructure failure:", error);
  process.exitCode = 1;
});
