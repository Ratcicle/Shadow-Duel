import test from "node:test";
import assert from "node:assert/strict";

import ChainSystem from "../src/core/ChainSystem.js";
import { activateSpellTrapEffect } from "../src/core/effects/activation/execution.js";
import { canActivateSpellTrapEffectPreview } from "../src/core/effects/activation/preview.js";
import { canStartAction } from "../src/core/game/actions/guard.js";
import { tryActivateSpellTrapEffect } from "../src/core/game/spellTrap/activation.js";
import { bindCardInteractions } from "../src/core/game/ui/interactions.js";
import { buildActivationIndicatorsForPlayer } from "../src/core/game/ui/indicators.js";

function makePlayer(id, controllerType = "human") {
  return {
    id,
    name: id,
    controllerType,
    hand: [],
    field: [],
    spellTrap: [],
    graveyard: [],
    banished: [],
    fieldSpell: null,
  };
}

function makeInteractionHarness() {
  const player = makePlayer("player");
  const bot = makePlayer("bot", "ai");
  const handlers = {};
  const calls = {
    spellTrap: 0,
    monster: 0,
    fieldSpell: 0,
    target: 0,
    lastSpellTrapOptions: null,
  };
  const game = {
    player,
    bot,
    turn: "bot",
    phase: "main1",
    targetSelection: null,
    devLog() {},
    ui: {
      bindPlayerSpellTrapClick(handler) {
        handlers.spellTrap = handler;
      },
      bindPlayerFieldClick(handler) {
        handlers.field = handler;
      },
      bindPlayerFieldSpellClick(handler) {
        handlers.fieldSpell = handler;
      },
      bindBotSpellTrapClick(handler) {
        handlers.botSpellTrap = handler;
      },
      bindCardHover() {},
      log() {},
    },
    effectEngine: {
      canActivateSpellTrapEffectPreview: () => ({ ok: true }),
    },
    handleTargetSelectionClick() {
      calls.target += 1;
      return true;
    },
    async tryActivateSpellTrapEffect(_card, _selections, options = {}) {
      calls.spellTrap += 1;
      calls.lastSpellTrapOptions = options;
    },
    async tryActivateMonsterEffect() {
      calls.monster += 1;
    },
    activateFieldSpellEffect() {
      calls.fieldSpell += 1;
    },
    guardActionStart() {
      return { ok: true };
    },
  };
  bindCardInteractions.call(game);
  return { game, player, handlers, calls };
}

test("cliques no campo durante o turno adversario nao iniciam ativacoes", async () => {
  const { player, handlers, calls } = makeInteractionHarness();
  const cards = [
    {
      name: "Set Quick Spell",
      owner: "player",
      cardKind: "spell",
      subtype: "quick",
      isFacedown: true,
    },
    {
      name: "Set Trap",
      owner: "player",
      cardKind: "trap",
      subtype: "normal",
      isFacedown: true,
    },
    {
      name: "Face-up Spell",
      owner: "player",
      cardKind: "spell",
      subtype: "continuous",
      isFacedown: false,
    },
  ];

  for (const card of cards) {
    player.spellTrap = [card];
    await handlers.spellTrap(null, {}, 0);
  }

  player.field = [
    {
      name: "Quick Monster",
      owner: "player",
      cardKind: "monster",
      isFacedown: false,
      effects: [{ id: "quick", speed: 2, isQuickEffect: true }],
    },
  ];
  await handlers.field(null, {}, 0);

  player.fieldSpell = {
    name: "Field Spell",
    owner: "player",
    cardKind: "spell",
    subtype: "field",
  };
  await handlers.fieldSpell(null, {});

  assert.deepEqual(calls, {
    spellTrap: 0,
    monster: 0,
    fieldSpell: 0,
    target: 0,
    lastSpellTrapOptions: null,
  });
});

test("ativacao direta valida no proprio turno e Laboratory sao preservados", async () => {
  const { game, player, handlers, calls } = makeInteractionHarness();
  const playerQuick = {
    name: "Player Quick Spell",
    owner: "player",
    cardKind: "spell",
    subtype: "quick",
    isFacedown: true,
  };
  game.turn = "player";
  player.spellTrap = [playerQuick];

  await handlers.spellTrap(null, {}, 0);

  assert.equal(calls.spellTrap, 1);
  assert.equal(calls.lastSpellTrapOptions.quickSpellContext.legalWindow, true);

  const botQuick = {
    name: "Bot Quick Spell",
    owner: "bot",
    cardKind: "spell",
    subtype: "quick",
    isFacedown: true,
  };
  game.laboratoryModeEnabled = true;
  game.turn = "bot";
  game.bot.spellTrap = [botQuick];

  await handlers.botSpellTrap(null, {}, 0);

  assert.equal(calls.spellTrap, 2);
  assert.equal(calls.lastSpellTrapOptions.owner, game.bot);
  assert.equal(calls.lastSpellTrapOptions.quickSpellContext.legalWindow, true);
});

test("selecao de alvo pelo campo continua ativa no turno adversario", async () => {
  const { game, player, handlers, calls } = makeInteractionHarness();
  player.spellTrap = [{ name: "Target", cardKind: "trap" }];
  game.targetSelection = { kind: "effect" };

  await handlers.spellTrap(null, {}, 0);

  assert.equal(calls.target, 1);
  assert.equal(calls.spellTrap, 0);
});

test("janela de Chain aberta bloqueia uma ativacao paralela", () => {
  const player = makePlayer("player");
  const game = {
    turn: "player",
    phase: "main1",
    selectionState: "idle",
    eventResolutionDepth: 0,
    isResolvingEffect: false,
    devLog() {},
    chainSystem: { isChainWindowOpen: () => true },
  };

  const blocked = canStartAction.call(game, {
    actor: player,
    kind: "quick_spell_activation",
  });
  const selection = canStartAction.call(game, {
    actor: player,
    kind: "selection_interaction",
  });

  assert.equal(blocked.code, "BLOCKED_CHAIN_WINDOW_OPEN");
  assert.equal(selection.ok, true);
});

test("legalWindow forjado nao libera preview, pipeline ou execucao direta", async () => {
  const player = makePlayer("player");
  const card = {
    name: "Forged Quick Spell",
    owner: "player",
    cardKind: "spell",
    subtype: "quick",
    isFacedown: true,
    setTurn: 1,
    effects: [{ id: "quick", timing: "on_play", speed: 2, actions: [] }],
  };
  player.spellTrap.push(card);
  const engine = {
    game: { turn: "bot", turnCounter: 2, phase: "main1" },
  };
  const context = {
    quickSpellContext: { activationZone: "spellTrap", legalWindow: true },
  };

  const preview = canActivateSpellTrapEffectPreview.call(
    engine,
    card,
    player,
    "spellTrap",
    null,
    { activationContext: context, ...context },
  );
  const execution = await activateSpellTrapEffect.call(
    engine,
    card,
    player,
    null,
    "spellTrap",
    {
      quickSpellActivationFromSet: true,
      quickSpellContext: context.quickSpellContext,
    },
  );

  let guardConfig = null;
  const pipelineGame = {
    player,
    bot: makePlayer("bot", "ai"),
    guardActionStart(config) {
      guardConfig = config;
      return {
        ok: false,
        success: false,
        code: "BLOCKED_NOT_YOUR_TURN",
        reason: "Not your turn.",
      };
    },
    normalizeActivationResult: (result) => result,
    devLog() {},
    ui: { log() {} },
  };
  const pipeline = await tryActivateSpellTrapEffect.call(
    pipelineGame,
    card,
    null,
    { quickSpellContext: context.quickSpellContext },
  );

  assert.equal(preview.ok, false);
  assert.equal(preview.reason, "Not your turn.");
  assert.equal(execution.success, false);
  assert.equal(execution.reason, "Not your turn.");
  assert.equal(guardConfig.allowDuringOpponentTurn, undefined);
  assert.equal(pipeline.code, "BLOCKED_NOT_YOUR_TURN");
  assert.equal(card.isFacedown, true);
});

test("indicador de Magia Rapida baixada nao fica ativo no turno adversario", () => {
  const player = makePlayer("player");
  player.spellTrap.push({
    name: "Set Quick Spell",
    owner: "player",
    cardKind: "spell",
    subtype: "quick",
    isFacedown: true,
    setTurn: 1,
    effects: [{ id: "quick", timing: "on_play", speed: 2, actions: [] }],
  });
  const game = {
    player,
    turn: "bot",
    turnCounter: 2,
    phase: "main1",
    selectionState: "idle",
    eventResolutionDepth: 0,
    isResolvingEffect: false,
    devLog() {},
    chainSystem: { isChainWindowOpen: () => false },
    canStartAction(options) {
      return canStartAction.call(this, options);
    },
    effectEngine: {
      canActivateSpellTrapEffectPreview: () => ({ ok: true }),
    },
  };

  const indicators = buildActivationIndicatorsForPlayer.call(game, player);

  assert.deepEqual(indicators.spellTrap[0], {
    canActivate: false,
    label: "fora do seu turno",
  });
});

test("uma janela real oferece a Magia Rapida pelo modal da Chain", async () => {
  const player = makePlayer("player");
  const bot = makePlayer("bot", "ai");
  const quick = {
    name: "Legitimate Quick Spell",
    owner: "player",
    cardKind: "spell",
    subtype: "quick",
    isFacedown: true,
    setTurn: 1,
    effects: [
      {
        id: "quick",
        timing: "on_play",
        speed: 2,
        actions: [{ type: "test_action" }],
      },
    ],
  };
  player.spellTrap.push(quick);
  const trap = {
    name: "Legitimate Trap",
    owner: "player",
    cardKind: "trap",
    subtype: "normal",
    isFacedown: true,
    setTurn: 1,
    effects: [
      {
        id: "trap",
        timing: "on_event",
        event: "phase_end",
        speed: 2,
        actions: [{ type: "trap_action" }],
      },
    ],
  };
  const quickMonster = {
    name: "Legitimate Quick Monster",
    owner: "player",
    cardKind: "monster",
    isFacedown: false,
    effects: [
      {
        id: "monster_quick",
        timing: "ignition",
        speed: 2,
        isQuickEffect: true,
        actions: [{ type: "monster_action" }],
      },
    ],
  };
  player.spellTrap.push(trap);
  player.field.push(quickMonster);
  const offeredBatches = [];
  const resolved = [];
  const game = {
    player,
    bot,
    turn: "bot",
    turnCounter: 2,
    phase: "main1",
    ui: {
      log() {},
      async showChainResponseModal(activatable) {
        offeredBatches.push([...activatable]);
        if (offeredBatches.length > 1) return null;
        return activatable.find((candidate) => candidate.card === quick) || null;
      },
    },
    getOpponent(owner) {
      return owner === player ? bot : player;
    },
    canActivateCardEffectUnderRestrictions: () => ({ ok: true }),
    effectEngine: {
      resolveTargets(_requirements, _ctx, selections) {
        return { ok: true, needsSelection: false, targets: selections || {} };
      },
      checkActionPreviewRequirements: () => ({ ok: true }),
      async applyActions(actions) {
        resolved.push(...actions);
        return { success: true, needsSelection: false };
      },
      registerOncePerTurnUsage() {},
    },
    async emit(_eventName, payload, options = {}) {
      return {
        ok: true,
        payload,
        entries: [],
        collectedOnly: options.collectTriggersOnly === true,
      };
    },
    async emitEffectActivated(payload, options = {}) {
      return this.emit("effect_activated", payload, options);
    },
    notify() {},
    updateBoard() {},
    checkWinCondition() {},
    async flushPendingChainEvents() {
      return { ok: true, flushed: 0 };
    },
    async presentSpellTrapActivationFlip() {},
    async moveCard(card, owner, toZone) {
      const index = owner.spellTrap.indexOf(card);
      if (index >= 0) owner.spellTrap.splice(index, 1);
      owner[toZone].push(card);
      return { success: true, toZone };
    },
  };
  const chain = new ChainSystem(game);
  game.chainSystem = chain;

  await chain.openEventWindow({
    type: "phase_change",
    event: "phase_end",
    openState: true,
    legalWindow: true,
    triggerPlayer: bot,
    player: bot,
  });

  assert.deepEqual(
    offeredBatches[0].map((candidate) => candidate.card),
    [trap, quick, quickMonster],
  );
  assert.equal(offeredBatches.length, 2);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].type, "test_action");
  assert.equal(player.graveyard.includes(quick), true);
});
