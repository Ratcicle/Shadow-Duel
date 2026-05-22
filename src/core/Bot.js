import Player from "./Player.js";
import { cardDatabase, cardDatabaseById } from "../data/cards.js";
import Card from "./Card.js";
import { getStrategyFor } from "./ai/StrategyRegistry.js";
import { beamSearchTurn, greedySearchWithEvalV2 } from "./ai/BeamSearch.js";
import { turnLineSearch } from "./ai/TurnLineSearch.js";
import {
  compactPlanningDiffs,
  diffPlanningSummaries,
  fingerprintAction,
  isMeaningfulPlanningDiff,
  summarizePlanningState,
} from "./ai/common/planningDiagnostics.js";
import { botLogger } from "./BotLogger.js";

function hasValue(value) {
  return value !== undefined && value !== null;
}

function resolvePlannerMode(game, profile = {}) {
  const configuredMode = game?.turnLineSearchMode ?? game?.arenaPlannerMode;
  if (configuredMode === "off") return "off";
  if (configuredMode === "always") return "always";
  if (configuredMode === "critical") return "critical";
  if (game?.turnLineSearchEnabled === true) return "always";
  if (profile?.mode) return profile.mode;
  return profile?.enabled === true ? "critical" : "off";
}

export default class Bot extends Player {
  constructor(archetype = "shadowheart") {
    super("bot", "Opponent", "ai");
    this.maxSimulationsPerPhase = 20;
    this.maxChainedActions = 6; // Aumentado de 3 para 6 - permite múltiplas ações + efeitos
    this.setPreset(archetype);
  }
  static getAvailablePresets() {
    return [
      { id: "shadowheart", label: "Shadow-Heart" },
      { id: "luminarch", label: "Luminarch" },
      { id: "void", label: "Void" },
      { id: "dragon", label: "Dragon" },
      { id: "arcanist", label: "Arcanist" },
    ];
  }

  setPreset(presetId = "shadowheart") {
    const validIds = Bot.getAvailablePresets().map((p) => p.id);
    this.archetype = validIds.includes(presetId) ? presetId : "shadowheart";

    this.strategy = getStrategyFor(this.archetype, this);
  }

  // Sobrescreve buildDeck para usar deck do arquétipo selecionado
  buildDeck() {
    this.deck = [];
    const copies = {};

    const addCard = (data) => {
      copies[data.id] = copies[data.id] || 0;
      if (copies[data.id] >= 3 || this.deck.length >= this.maxDeckSize)
        return false;
      this.deck.push(new Card(data, this.id));
      copies[data.id]++;
      return true;
    };

    // Seleciona deck baseado no arquétipo
    const deckList =
      this.archetype === "shadowheart"
        ? this.getShadowHeartDeck()
        : this.archetype === "void"
          ? this.getVoidDeck()
          : this.archetype === "dragon"
            ? this.getDragonDeck()
            : this.archetype === "arcanist"
              ? this.getArcanistDeck()
              : this.getLuminarchDeck();

    for (const cardId of deckList) {
      const data = cardDatabaseById.get(cardId);
      if (data) {
        addCard(data);
      }
    }

    this.shuffleDeck();
  }

  // Deck Shadow-Heart otimizado para combos e fusões
  getShadowHeartDeck() {
    return [
      // === MONSTROS ===
      69, // Shadow-Heart Death Wyrm (1x)
      57, // Shadow-Heart Demon Arctroth (1x)
      64,
      64, // Shadow-Heart Scale Dragon (2x)
      70, // Shadow-Heart Leviathan (1x)
      67, // Shadow-Heart Griffin (1x)
      52,
      52, // Shadow-Heart Abyssal Eel (2x)
      60,
      60, // Shadow-Heart Imp (2x)
      71,
      71,
      71, // Shadow-Heart Void Mage (3x)
      62, // Shadow-Heart Coward (1x)
      61, // Shadow-Heart Gecko (1x)
      53, // Shadow-Heart Specter (1x)

      // === SPELLS ===
      68, // Darkness Valley (1x)
      13,
      13, // Polymerization (2x)
      58, // Shadow-Heart Battle Hymn (1x)
      72, // Shadow-Heart Cathedral (1x)
      59,
      59,
      59, // Shadow-Heart Covenant (3x)
      63,
      63, // Shadow-Heart Infusion (2x)
      54, // Shadow-Heart Purge (1x)
      65, // Shadow-Heart Rage (1x)
      66, // Shadow-Heart Shield (1x)
      73, // The Shadow Heart (1x)
    ];
  }

  // Deck Luminarch completo (Tank/Control/Versatility) — 30 cards
  getLuminarchDeck() {
    return [
      109, // Luminarch Aurora Seraph (Lv8 2800 ATK + heal + protection, priority 14)
      108, // Luminarch Radiant Lancer (Lv8 2600 ATK + ATK gain, priority 14)
      105, // Luminarch Celestial Marshal (Lv7 self-SS tank, priority 15)
      107, // Luminarch Sanctum Protector (Lv7 2800 DEF tank, priority 14)
      104,
      104, // Luminarch Moonblade Captain (Lv6 recursion + double atk, priority 16)
      103,
      103,
      103, // Luminarch Aegisbearer (taunt tank S-tier, priority 20)
      117, // Luminarch Enchanted Halberd (Lv4 SS trigger, priority 11)
      110,
      110, // Luminarch Sanctified Arbiter (busca Citadel, A-tier, priority 16)
      101,
      101,
      101, // Luminarch Valiant - Knight of the Dawn (searcher A-tier, priority 18)
      106, // Luminarch Magic Sickle (Lv3 hand battle trick + spell recovery, priority 12)
      115, // Luminarch Crescent Shield (equip, priority 10)
      113, // Luminarch Holy Ascension (ATK buff, priority 7)
      102, // Luminarch Holy Shield (proteção S-tier, priority 20)
      111, // Luminarch Knights Convocation (discard Lv7+ → search Lv4-, priority 9)
      118,
      118, // Luminarch Moonlit Blessing (recursion A-tier, priority 17)
      114, // Luminarch Radiant Wave (removal, priority 8)
      119, // Luminarch Sacred Judgment (comeback, priority 8)
      116, // Luminarch Spear of Dawnfall (ATK/DEF zero, priority 7)
      261, // Luminarch Sunforged Blade (LP-gain equip payoff)
      13,
      13, // Polymerization (fusion para Megashield/Pure Knight, priority 10)
      112,
      112, // Sanctum of the Luminarch Citadel (field spell S-tier, priority 22)
    ];
  }

  getVoidDeck() {
    return [
      // Bosses and high-impact Void monsters
      258, // Arcturus, Lord of the Void
      162, // Void Slayer Brute
      172, // Thousand-Arms of the Void
      158, // Void Bone Spider
      164, // Void Serpent Drake
      159, // Void Forgotten Knight
      155, // Void Haunter
      153, // Void Beast

      // Core engine
      151,
      151,
      151, // Void Conjurer (3x)
      161,
      161, // Void Tenebris Horn (2x)
      152,
      152, // Void Walker (2x)
      156, // Void Ghost Wolf
      154,
      154,
      154, // Void Hollow (3x)
      160, // Void Raven

      // Spells and traps
      13,
      13,
      13, // Polymerization (3x)
      166, // Sealing the Void
      167, // The Void
      168, // Void Gravitational Pull
      169,
      169, // Void Lost Throne (2x)
      170, // Void Mirror Dimension
    ];
  }

  getDragonDeck() {
    return [
      // === MONSTERS ===
      // Extreme Dragons (trimmed for consistency; fieldLimit allows only 1 face-up at a time)
      251, // Volcanic Extreme Dragon (2600 ATK — battle-indestructible alone + GY burn)
      253, // Galaxy Extreme Dragon (2900 ATK — opp GY banish + once per duel survival)
      254, // Forest Extreme Dragon (2500 ATK — standby LP heal + ATK gain)
      // Big Dragons
      24,  // Black Bull Dragon (2500 ATK — SS by discarding 2 Dragons, double attack)
      29,  // Purified Crystal Dragon (2500 ATK — SS by banishing 3 GY Dragons, heal)
      28,  // Abyssal Serpent Dragon (2200 ATK — stall exchange effect)
      25,  // Hellkite Dragon (2300 ATK — SS from hand by sending field Dragon to GY)
      21,  // Majestic Silver Dragon (2500 ATK — alt tribute 1 Dragon, position switch)
      22,  // Darkness Dragon (2000+ ATK — destroys field dragons to gain ATK)
      12,  // Luminous Dragon (2000 ATK — empty-field SS + discard recovery)
      // Mid Dragons
      16, 16, 16, // Armored Dragon (1600 ATK — search lv4 Dragon on normal summon)
      18, 18, 18, // Grey Dragon (1800 ATK — SS buff +500, GY return self)
      20, 20, 20, // Luminescent Dragon (1500 ATK — NS revives lv4- from GY)
      33,         // Boneflame Dragon (GY ignition — send field Dragon, gains 300 per GY Dragon)
      19, 19,     // Voltaic Dragon (1200 ATK — SS if control Dragon, 800 burn on discard)
      // === SPELLS ===
      256,        // Converging Stars (discard 1; reduce hand monster levels -2 until EOT)
      26,         // Hellkite Roar (control lv7+ Dragon: destroy 1 opp spell/trap)
      13, 13,     // Polymerization (fusion: Tech-Void or Radiant Cosmic)
      15,         // Call of the Haunted (trap: revive from GY)
      27,         // Jagged Peak of the Dragons (field: GY search + counter + SS on 5 counters)
      257,        // Extreme Dragon Awakening (cont. spell — search/SS lv8+ Dragon from hand)
      // === TRAPS ===
      32,         // Dragon Spirit Sanctuary (Dragon targeted: return to hand + SS from hand)
    ];
  }

  getArcanistDeck() {
    return [
      // Monsters - 14
      202, 202, 202, // Arcanist Apprentice
      207, 207, 207, // Albus, Arcanist of Ice
      214, 214, // Azrath
      206, 206, // Tera
      205, 205, // Viridis
      208, // Master of Mirrors Arcanist
      213, // Elementalist

      // Spells and traps - 16
      212, 212, 212, // Grand Library
      201, 201, 201, // Grimoire
      216, 216, 216, // Seismic Impact
      211, 211, // Ink River
      204, 204, // Lightning Lance
      210, // Ice Barrier
      203, // Crimson Explosion
      209, // Meeting
    ];
  }

  // Sobrescreve buildExtraDeck para usar fusões do arquétipo
  buildExtraDeck() {
    const extraDeckList =
      this.archetype === "shadowheart"
        ? this.getShadowHeartExtraDeck()
        : this.archetype === "void"
          ? this.getVoidExtraDeck()
          : this.archetype === "dragon"
            ? this.getDragonExtraDeck()
            : this.archetype === "arcanist"
              ? this.getArcanistExtraDeck()
              : this.getLuminarchExtraDeck();
    super.buildExtraDeck(extraDeckList);
  }

  // Extra Deck Shadow-Heart
  getShadowHeartExtraDeck() {
    return [
      74, // Shadow-Heart Demon Dragon (fusão principal)
      75, // Shadow-Heart Armored Arctroth (ascensão de Demon Arctroth)
      77, // Shadow-Heart Warlord (fusão genérica, 2 Shadow-Heart)
    ];
  }

  // Extra Deck Luminarch (Fusion + Ascension)
  getLuminarchExtraDeck() {
    return [
      120, // Luminarch Megashield Barbarias (fusion tank, 3000 DEF)
      121, // Luminarch Fortress Aegis (ascensão de Aegisbearer)
      122, // Luminarch Pure Knight (fusion search + LP cost reduction)
    ];
  }

  getVoidExtraDeck() {
    return [
      157, // Void Hollow King (fusion)
      163, // Void Berserker (fusion)
      165, // Void Hydra Titan (fusion)
      171, // Void Cosmic Walker (ascension of Void Walker)
      173, // Malicious Demon of the Void (ascension of Thousand-Arms of the Void)
    ];
  }

  getDragonExtraDeck() {
    return [
      17,  // Metal Armored Dragon (ascension from Armored Dragon)
      30,  // Tech-Void Dragon (fusion: Voltaic Dragon + lv5+ Dragon)
      259, // Radiant Cosmic Dragon (fusion: 3 Dragons, including 1 LIGHT)
      260, // Rainbow Cosmic Dragon (ascension from Purified Crystal Dragon)
    ];
  }

  getArcanistExtraDeck() {
    return [];
  }

  resolveOpponent(game) {
    if (!game) return null;
    if (typeof game.getOpponent === "function") {
      return game.getOpponent(this);
    }
    return this.id === "player" ? game.bot : game.player;
  }

  async makeMove(game) {
    if (!game || game.gameOver) return;

    try {
      game._arenaTracker?.recordProgress?.("bot_make_move_enter", game, {
        actor: this.id,
      });
      game._arenaTracker?.recordProgress?.("bot_make_move_guard_before", game, {
        actor: this.id,
      });
      const guard = game.canStartAction({ actor: this, kind: "bot_turn" });
      console.log(`[Bot.makeMove] Guard check:`, guard);
      game._arenaTracker?.recordProgress?.("bot_make_move_guard_after", game, {
        actor: this.id,
        ok: !!guard.ok,
        reason: guard.reason || null,
      });
      if (!guard.ok) {
        console.log(`[Bot.makeMove] ❌ Guard blocked: ${guard.reason}`);
        return;
      }

      const phase = game.phase;
      console.log(`[Bot.makeMove] Phase: ${phase}`);
      game._arenaTracker?.recordProgress?.("bot_make_move_phase", game, {
        actor: this.id,
        phase,
      });

      if (phase === "main1" || phase === "main2") {
        await this.playMainPhase(game);
        game._arenaTracker?.recordProgress?.("bot_make_move_after_main_phase", game, {
          actor: this.id,
          phase,
        });
        if (!game.gameOver && game.phase === phase) {
          const actionDelayMs = Number.isFinite(game?.aiActionDelayMs)
            ? game.aiActionDelayMs
            : 500;
          setTimeout(() => game.nextPhase(), actionDelayMs);
        }
        return;
      }

      if (phase === "battle") {
        this.playBattlePhase(game);
        game._arenaTracker?.recordProgress?.("bot_make_move_after_battle_phase", game, {
          actor: this.id,
        });
        return;
      }

      if (phase === "end") {
        game.endTurn();
      }
    } catch (error) {
      game._arenaTracker?.recordProgress?.("bot_make_move_error", game, {
        actor: this.id,
        error: error?.message || String(error),
      });
      console.error(
        `[Bot.makeMove] ❌ FATAL ERROR in ${game.phase} phase:`,
        error,
      );
      console.error("[Bot.makeMove] Stack trace:", error.stack);
      // Fallback: forçar nextPhase para não travar o jogo
      if (!game.gameOver && typeof game.nextPhase === "function") {
        console.log("[Bot.makeMove] ⚠️ Forcing nextPhase() after error");
        game.nextPhase();
      }
    }
  }

  async playMainPhase(game) {
    // Verificar se o jogo já acabou
    if (game.gameOver) {
      return;
    }
    game._arenaTracker?.recordProgress?.("bot_main_phase_enter", game, {
      actor: this.id,
    });

    const bot = this;
    const opponent = game.player.id === bot.id ? game.bot : game.player;
    const useAutomaticAscension =
      this.strategy?.shouldUseAutomaticAscensionShortcut?.(game, this) !==
      false;

    // === LOG DE ESTADO (DEV MODE) ===
    if (bot.debug) {
      console.log(
        `\n[Bot.playMainPhase] 📊 Estado de ${bot.id} no início da main phase:`,
      );
      console.log(
        `  Hand (${bot.hand.length}): ${
          bot.hand.map((c) => c.name).join(", ") || "(vazia)"
        }`,
      );
      console.log(
        `  Field (${bot.field.length}): ${
          bot.field
            .map(
              (c) =>
                `${c.name}${
                  c.isFacedown
                    ? "(↓)"
                    : c.position === "attack"
                      ? "(↑ATK)"
                      : "(↑DEF)"
                }`,
            )
            .join(", ") || "(vazio)"
        }`,
      );
      console.log(
        `  Graveyard (${bot.graveyard.length}): ${
          bot.graveyard.map((c) => c.name).join(", ") || "(vazio)"
        }`,
      );
      console.log(`  Field Spell: ${bot.fieldSpell?.name || "(nenhum)"}`);
      console.log(
        `  LP: ${bot.lp} | Summon Count: ${bot.summonCount}/${1 + (bot.additionalNormalSummons || 0)}`,
      );
    }

    let successfulActions = 0;
    let totalAttempts = 0;
    const maxSuccessfulActions = this.maxChainedActions || 2;
    const maxTotalAttempts = 10; // Limite de segurança contra loops infinitos

    // Track de ações que já falharam neste turno para não tentar novamente
    const failedActionsThisTurn = new Set();

    // Flag para usar evaluateBoardV2
    const useV2Evaluation = true;

    while (
      successfulActions < maxSuccessfulActions &&
      totalAttempts < maxTotalAttempts
    ) {
      totalAttempts++;

      // Try Ascension before other actions if available
      const ascended = useAutomaticAscension
        ? await this.tryAscensionIfAvailable(game)
        : false;
      if (ascended) {
        // Allow subsequent actions after ascension
        const successfulActionDelayMs = Number.isFinite(
          game?.aiSuccessfulActionDelayMs,
        )
          ? game.aiSuccessfulActionDelayMs
          : game?.phaseDelayMs || 0;
        await new Promise((resolve) =>
          setTimeout(resolve, successfulActionDelayMs),
        );
      }

      const rawActions = this.generateMainPhaseActions(game);
      const sequencedActions = this.sequenceActions(rawActions);

      // Filtrar ações que já falharam neste turno
      const actions = sequencedActions.filter((a) => {
        const actionKey = `${a.type}:${a.cardId || a.card?.id || a.index}`;
        return !failedActionsThisTurn.has(actionKey);
      });

      const fallbackActions = this.filterValidActionsForCurrentState(
        actions,
        game,
      );

      console.log(
        `[Bot.playMainPhase] Generated ${rawActions.length} raw actions, ${actions.length} sequenced actions (${failedActionsThisTurn.size} filtered)`,
      );
      game._arenaTracker?.recordProgress?.("ai_decision_before", game, {
        actor: this.id,
        attempt: totalAttempts,
        rawActions: rawActions.length,
        sequencedActions: sequencedActions.length,
        actions: actions.length,
        fallbackActions: fallbackActions.length,
        failedThisTurn: failedActionsThisTurn.size,
      });
      if (actions.length > 0) {
        console.log(
          `[Bot.playMainPhase] Actions:`,
          actions.map((a) => `${a.type}:${a.card?.name || a.index}`),
        );
      }

      // 📊 Log de fase vazia
      if (!actions.length) {
        game._arenaTracker?.recordProgress?.("ai_decision_after", game, {
          actor: this.id,
          attempt: totalAttempts,
          selected: false,
          reason: "no_actions_generated",
        });
        if (botLogger) {
          botLogger.logEmptyPhase(
            this.id,
            game.turnCounter || 0,
            game.phase || "unknown",
            "NO_ACTIONS_GENERATED",
            {
              lp: game.player?.lp,
              handSize: (game.player?.hand || []).length,
              fieldSize: (game.player?.field || []).length,
              gySize: (game.player?.graveyard || []).length,
            },
          );
        }
        break;
      }

      let bestAction = null;
      let pendingPlannerTrace = null;

      const planningStrategy = this.strategy || this;
      const planningContext = {
        game,
        bot: this,
        strategy: planningStrategy,
        actions,
        fallbackActions,
        attempt: totalAttempts,
        useV2Evaluation,
      };
      const planningProfile =
        typeof planningStrategy.getPlanningProfile === "function"
          ? planningStrategy.getPlanningProfile(game, planningContext) || {}
          : {};
      planningContext.profile = planningProfile;
      const plannerMode = resolvePlannerMode(game, planningProfile);
      const plannerForced = plannerMode === "always";
      const explicitPlannerOptIn =
        plannerMode !== "off" && (plannerForced || planningProfile.enabled === true);
      const shouldUsePlanner =
        explicitPlannerOptIn &&
        (plannerForced ||
        (typeof planningStrategy.shouldUseDeepPlanning === "function"
          ? planningStrategy.shouldUseDeepPlanning(game, planningContext)
          : true));

      if (shouldUsePlanner && actions.length > 0) {
        const plannerBeamWidth =
          (hasValue(game.turnLineSearchBeamWidth)
            ? game.turnLineSearchBeamWidth
            : undefined) ??
          planningProfile.beamWidth ??
          game.arenaPlannerBeamWidth ??
          game.turnLineSearchBeamWidth ??
          game.arenaBeamWidth ??
          2;
        const plannerMaxDepth =
          (hasValue(game.turnLineSearchMaxDepth)
            ? game.turnLineSearchMaxDepth
            : undefined) ??
          planningProfile.maxDepth ??
          game.arenaPlannerMaxDepth ??
          game.turnLineSearchMaxDepth ??
          game.arenaMaxDepth ??
          2;
        const plannerNodeBudget =
          (hasValue(game.turnLineSearchNodeBudget)
            ? game.turnLineSearchNodeBudget
            : undefined) ??
          planningProfile.nodeBudget ??
          game.arenaPlannerNodeBudget ??
          game.turnLineSearchNodeBudget ??
          game.arenaNodeBudget ??
          100;
        const plannerCandidateLimit =
          (hasValue(game.turnLineSearchCandidateLimit)
            ? game.turnLineSearchCandidateLimit
            : undefined) ??
          planningProfile.candidateLimit ??
          game.arenaPlannerCandidateLimit ??
          game.turnLineSearchCandidateLimit ??
          actions.length;
        const plannerTurnMode =
          game.turnLineSearchTurnMode ||
          planningProfile.turnMode ||
          game.arenaPlannerTurnMode ||
          "mainOnly";
        const plannerBattleStepLimit =
          (hasValue(game.turnLineSearchBattleStepLimit)
            ? game.turnLineSearchBattleStepLimit
            : undefined) ??
          planningProfile.battleStepLimit ??
          game.arenaPlannerBattleStepLimit ??
          1;

        console.log(
          `[Bot.playMainPhase] Running TurnLineSearch with ${actions.length} actions (width=${plannerBeamWidth}, depth=${plannerMaxDepth}, budget=${plannerNodeBudget}, battleSteps=${plannerBattleStepLimit})...`,
        );
        const plannerResult = await turnLineSearch(game, planningStrategy, {
          beamWidth: plannerBeamWidth,
          maxDepth: plannerMaxDepth,
          nodeBudget: plannerNodeBudget,
          candidateLimit: plannerCandidateLimit,
          turnMode: plannerTurnMode,
          battleStepLimit: plannerBattleStepLimit,
          useV2Evaluation,
          preGeneratedActions: actions,
          profile: planningProfile,
          planningContext,
        });

        game._arenaTracker?.recordProgress?.("ai_turn_line_search", game, {
          actor: this.id,
          plannerMode,
          plannerTurnMode,
          plannerBattleStepLimit,
          plannerUsed: Boolean(plannerResult?.action),
          plannedLineLength: plannerResult?.sequence?.length || 0,
          plannedNodesEvaluated: plannerResult?.nodesEvaluated || 0,
          plannedScore: plannerResult?.score ?? null,
          plannedBaseScore: plannerResult?.baseScore ?? null,
          plannedMilestoneScore: plannerResult?.milestoneScore ?? null,
          plannedMilestones: (plannerResult?.milestones || []).slice(0, 8),
          plannedFirstAction: fingerprintAction(plannerResult?.action),
          selectedFirstAction: fingerprintAction(plannerResult?.action),
          plannedTerminalDigest:
            plannerResult?.diagnostics?.terminalSummary || null,
          plannerReason: plannerResult?.reason || "no_plan",
        });

        console.log(`[Bot.playMainPhase] TurnLineSearch result:`, plannerResult);
        if (plannerResult?.action) {
          bestAction = plannerResult.action;
          pendingPlannerTrace = plannerResult;
          console.log(
            `[Bot.playMainPhase] ✅ TurnLineSearch chose:`,
            bestAction,
          );
        } else {
          console.log(`[Bot.playMainPhase] ❌ TurnLineSearch returned no action`);
        }
      }

      // DECISÃO: Usar beam search ou greedy?
      // Se tem 2+ opções, usa beam search. Senão, greedy.
      if (!bestAction && actions.length >= 2) {
        // Beam search com parâmetros do Arena (ou defaults)
        const beamWidth = game.arenaBeamWidth ?? 2;
        const maxDepth = game.arenaMaxDepth ?? 2;
        const nodeBudget = game.arenaNodeBudget ?? 100;

        console.log(
          `[Bot.playMainPhase] Running beam search with ${actions.length} actions (width=${beamWidth}, depth=${maxDepth}, budget=${nodeBudget})...`,
        );
        const searchResult = await beamSearchTurn(game, this, {
          beamWidth,
          maxDepth,
          nodeBudget,
          useV2Evaluation,
          preGeneratedActions: actions, // BUGFIX: Pass pre-generated actions as fallback
        });

        console.log(`[Bot.playMainPhase] Beam search result:`, searchResult);
        if (searchResult && searchResult.action) {
          bestAction = searchResult.action;
          console.log(`[Bot.playMainPhase] ✅ Beam search chose:`, bestAction);
        } else {
          console.log(`[Bot.playMainPhase] ❌ Beam search returned no action`);
        }
      }

      // Fallback: se beam search não retornou nada, ou só tem 1 opção, usa greedy
      if (!bestAction) {
        console.log(`[Bot.playMainPhase] Running greedy search...`);
        const greedyResult = await greedySearchWithEvalV2(game, this, {
          useV2Evaluation,
          preGeneratedActions: actions, // BUGFIX: Pass pre-generated actions as fallback
        });

        console.log(`[Bot.playMainPhase] Greedy search result:`, greedyResult);
        if (greedyResult && greedyResult.action) {
          bestAction = greedyResult.action;
          console.log(`[Bot.playMainPhase] ✅ Greedy chose:`, bestAction);
        } else {
          console.log(`[Bot.playMainPhase] ❌ Greedy returned no action`);

          // 🔧 EMERGENCY FIX: Se greedy falhou mas temos ações, forçar primeira
          if (!bestAction && actions.length > 0) {
            bestAction =
              fallbackActions.length > 0 ? fallbackActions[0] : actions[0];
            console.warn(
              `[Bot.playMainPhase] 🚨 EMERGENCY FALLBACK: Forcing first action to avoid pass`,
            );
          }
        }
      }

      // BUGFIX: Ultimate fallback - Se search falhou mas temos ações, usar a primeira
      if (!bestAction) {
        let finalFallback = fallbackActions;
        if (!finalFallback.length && actions.length > 0) {
          const regenerated = this.sequenceActions(
            this.generateMainPhaseActions(game),
          );
          finalFallback = this.filterValidActionsForCurrentState(
            regenerated,
            game,
          );
        }

        if (finalFallback.length > 0) {
          bestAction = finalFallback[0];
          console.log(
            `[Bot.playMainPhase] ?? Using ultimate fallback: first valid action`,
            bestAction,
          );
        }
      }

      // Se ainda não tem ação, break
      if (!bestAction) {
        console.log(`[Bot.playMainPhase] ⚠️ No action selected, breaking loop`);
        game._arenaTracker?.recordProgress?.("ai_decision_after", game, {
          actor: this.id,
          attempt: totalAttempts,
          selected: false,
          reason: "no_action_selected",
        });
        break;
      }

      game._arenaTracker?.recordProgress?.("ai_decision_after", game, {
        actor: this.id,
        attempt: totalAttempts,
        selected: true,
        actionType: bestAction.type || null,
        card: bestAction.card?.name || bestAction.cardName || null,
      });

      if (bestAction.type === "simulatedBattle") {
        console.log(
          `[Bot.playMainPhase] Planner selected battle bridge; advancing to Battle Phase`,
          bestAction,
        );
        game._arenaTracker?.recordProgress?.("ai_plan_phase_bridge", game, {
          actor: this.id,
          attempt: totalAttempts,
          plannedAction: fingerprintAction(bestAction),
          plannedMilestones: (pendingPlannerTrace?.milestones || []).slice(0, 8),
          plannerReason: pendingPlannerTrace?.reason || null,
        });
        await game.nextPhase();
        return;
      }

      // 📊 Log de decisão (ranking e coerência)
      if (botLogger && actions.length > 0) {
        const sorted = [...actions].sort(
          (a, b) => (b.priority || 0) - (a.priority || 0),
        );
        let ranking = -1;
        for (let i = 0; i < sorted.length; i++) {
          if (
            sorted[i].type === bestAction.type &&
            sorted[i].index === bestAction.index
          ) {
            ranking = i;
            break;
          }
        }
        if (ranking >= 0) {
          let coherence = ranking === 0 ? 1.0 : ranking < 3 ? 0.7 : 0.4;
          botLogger.logDecision(
            this.id,
            game.turnCounter || 0,
            game.phase || "unknown",
            actions.length,
            ranking,
            coherence,
            bestAction,
          );
        }
      }

      const actionSuccess = await this.executeMainPhaseAction(game, bestAction);
      if (pendingPlannerTrace) {
        const expectedSummary =
          pendingPlannerTrace.diagnostics?.firstStepSummary || null;
        const actualSummary = summarizePlanningState(game, {
          bot: this,
          strategy: planningStrategy,
        });
        const diff = diffPlanningSummaries(expectedSummary, actualSummary);
        const meaningfulDiff = isMeaningfulPlanningDiff(diff);
        const comparePayload = {
          actor: this.id,
          actionSuccess: !!actionSuccess,
          plannedAction: fingerprintAction(pendingPlannerTrace.action),
          actualAction: fingerprintAction(bestAction),
          selectedFirstAction: fingerprintAction(pendingPlannerTrace.action),
          executedFirstAction: fingerprintAction(bestAction),
          matched: !!actionSuccess && !meaningfulDiff,
          diffSeverity: actionSuccess ? diff.severity : "action_failed",
          mismatchReason: actionSuccess ? diff.severity : "action_failed",
          diffs: compactPlanningDiffs(diff.diffs || [], 6),
          plannedMilestones: (pendingPlannerTrace.milestones || []).slice(0, 8),
          plannerReason: pendingPlannerTrace.reason || null,
        };
        game._arenaTracker?.recordProgress?.(
          actionSuccess
            ? "ai_plan_execution_compare"
            : "ai_plan_execution_failed",
          game,
          comparePayload,
        );
      }
      if (!actionSuccess) {
        // Marcar ação como falhada para não tentar novamente
        const failedKey = `${bestAction.type}:${bestAction.cardId || bestAction.card?.id || bestAction.index}`;
        failedActionsThisTurn.add(failedKey);
        console.log(
          `[Bot.playMainPhase] ❌ Action failed, added to blacklist: ${failedKey}`,
        );

        if (botLogger?.logEmptyPhase) {
          botLogger.logEmptyPhase(
            this.id,
            game.turnCounter,
            game.phase,
            "ACTION_FAILED",
            {
              lp: this.lp,
              handSize: this.hand.length,
              fieldSize: this.field.length,
              gySize: this.graveyard.length,
            },
          );
        }
        if (typeof game.updateBoard === "function") {
          game.updateBoard();
        }
        // NÃO dar break aqui - tentar próxima ação disponível
        continue;
      }

      // Incrementar contador de ações bem-sucedidas
      successfulActions += 1;

      const successfulActionDelayMs = Number.isFinite(
        game?.aiSuccessfulActionDelayMs,
      )
        ? game.aiSuccessfulActionDelayMs
        : game?.phaseDelayMs || 0;
      await new Promise((resolve) =>
        setTimeout(resolve, successfulActionDelayMs),
      );
    }

    // Final chance to ascend if no actions left
    if (useAutomaticAscension) {
      await this.tryAscensionIfAvailable(game);
    }
  }

  isSameBattleCard(candidate, original) {
    if (!candidate || !original) return false;
    if (candidate.instanceId != null && original.instanceId != null) {
      return candidate.instanceId === original.instanceId;
    }
    return candidate.id === original.id;
  }

  playBattlePhase(game) {
    const guard = game.canStartAction({
      actor: this,
      kind: "bot_attack",
      phaseReq: "battle",
    });
    if (!guard.ok) {
      console.log(`[Bot.playBattlePhase] ⚠️ Guard blocked:`, guard);
      return;
    }
    console.log(`[Bot.playBattlePhase] ✅ Starting battle phase evaluation`);
    const opponent = this.resolveOpponent(game);
    if (!opponent) return;
    const battleDelayMs = Number.isFinite(game?.aiBattleDelayMs)
      ? game.aiBattleDelayMs
      : 800;
    const minDeltaToAttack = 0.05;

    const performAttack = () => {
      // Verificar se ainda podemos atacar
      if (game.gameOver) return;
      if (game.phase !== "battle") return; // Fase mudou durante resolução

      const availableAttackers = this.field.filter((m) => {
        if (!m || m.cardKind !== "monster") return false;
        if (m.position !== "attack") return false;
        if (m.cannotAttackThisTurn) return false;
        return game.getAttackAvailability?.(m)?.ok ?? true;
      });

      if (!availableAttackers.length) {
        setTimeout(() => game.nextPhase(), battleDelayMs);
        return;
      }

      let bestAttack = null;
      let bestDelta = -Infinity;
      let bestAttackerAtk = 0;
      const baseScore = this.evaluateBoard(game, this);
      const opponentLp = opponent.lp || 0;
      const totalAtkPotential = availableAttackers.reduce(
        (sum, m) => sum + (m.atk || 0),
        0,
      );

      for (const attacker of availableAttackers) {
        const isSecondAttack = (attacker.attacksUsedThisTurn || 0) >= 1;
        const attackThreshold = isSecondAttack ? 0.0 : minDeltaToAttack;
        const canDirectAttackNow =
          (opponent.field.length === 0 ||
            attacker.canAttackDirectlyThisTurn === true) &&
          !this.forbidDirectAttacksThisTurn &&
          !attacker.cannotAttackDirectly &&
          !attacker.canAttackAllOpponentMonstersThisTurn &&
          !(
            (attacker.attacksUsedThisTurn || 0) > 0 &&
            attacker.extraAttackTargetRestriction === "monster"
          );

        const tauntTargets = opponent.field.filter(
          (card) =>
            card &&
            card.cardKind === "monster" &&
            !card.isFacedown &&
            card.mustBeAttacked,
        );

        const possibleTargets =
          tauntTargets.length > 0
            ? [...tauntTargets]
            : opponent.field.length
              ? [...opponent.field, ...(canDirectAttackNow ? [null] : [])]
              : canDirectAttackNow
                ? [null]
                : [];

        for (const target of possibleTargets) {
          if (target === null && opponent.field.length > 0 && !canDirectAttackNow) {
            continue;
          }

          const simState = this.cloneGameState(game);
          const simAttacker = simState.bot.field.find(
            (c) => this.isSameBattleCard(c, attacker),
          );
          const simTarget = target
            ? simState.player.field.find((c) => this.isSameBattleCard(c, target))
            : null;

          // 🎯 BOOST: Atacar monstros facedown é geralmente vantajoso
          // - DEF estimado = 1500, então ATK >= 1600 provavelmente vence
          // - Remove ameaça desconhecida do campo
          const attackingFacedown = target && target.isFacedown;
          const highAtkAttacker = (attacker.atk || 0) >= 1600;

          if (!simAttacker) continue;

          this.simulateBattle(simState, simAttacker, simTarget);
          const scoreAfter = this.evaluateBoard(simState, simState.bot);
          let delta = scoreAfter - baseScore;
          const opponentLpAfter = simState.player.lp || 0;
          const attackerSurvived = simState.bot.field.some(
            (c) => this.isSameBattleCard(c, attacker),
          );
          const targetSurvived = target
            ? simState.player.field.some((c) => this.isSameBattleCard(c, target))
            : false;
          const lethalNow = opponentLpAfter <= 0;

          if (target === null) delta += 0.5;
          if (target && attackerSurvived) {
            delta += 0.3;
          }
          // 🎯 Bonus para atacar monstros facedown com atacante forte
          // Limpar ameaças desconhecidas é estratégico
          if (attackingFacedown && highAtkAttacker) {
            delta += 0.4; // Incentivar atacar facedowns
            if (!targetSurvived) {
              delta += 0.3; // Bonus extra se conseguiu destruir
            }
          }
          if (target === null && simState.player.field.length === 0) {
            if ((attacker.atk || 0) >= opponentLp) {
              delta += 6;
            } else if (totalAtkPotential >= opponentLp) {
              delta += 3;
            }
          }
          if (lethalNow) {
            delta += 10;
          }
          if (!attackerSurvived && !lethalNow) {
            delta -= targetSurvived ? 1.0 : 0.4;
          }
          if (target && !targetSurvived && attackerSurvived) {
            delta += 0.4;
          }
          if (
            target &&
            simAttacker &&
            simAttacker.cardKind === "monster" &&
            (simAttacker.atk || 0) <= (target.atk || 0)
          ) {
            delta -= 0.5;
          }

          const strategyBattleDelta =
            this.strategy?.scoreBattleAttackCandidate?.({
              attacker,
              target,
              baseDelta: delta,
              simState,
              game,
              bot: this,
              opponent,
              isSecondAttack,
              attackerSurvived,
              targetSurvived,
              lethalNow,
              opponentLpAfter,
            });
          if (Number.isFinite(strategyBattleDelta)) {
            delta += strategyBattleDelta;
          } else if (Number.isFinite(strategyBattleDelta?.scoreDelta)) {
            delta += strategyBattleDelta.scoreDelta;
          }

          if (
            delta > bestDelta + 0.01 ||
            (Math.abs(delta - bestDelta) <= 0.01 &&
              (attacker.atk || 0) > bestAttackerAtk)
          ) {
            bestDelta = delta;
            bestAttackerAtk = attacker.atk || 0;
            bestAttack = { attacker, target, threshold: attackThreshold };
          }
        }
      }

      const finalThreshold = Math.max(
        bestAttack?.threshold ?? minDeltaToAttack,
        0.05,
      );
      if (bestAttack && bestDelta > finalThreshold) {
        // Verificar se atacante ainda está no campo antes de atacar
        const attackerStillOnField = this.field.includes(bestAttack.attacker);
        const targetStillOnField =
          bestAttack.target === null ||
          opponent.field.includes(bestAttack.target);

        if (!attackerStillOnField || !targetStillOnField) {
          // Cartas foram removidas, recalcular na próxima iteração
          setTimeout(() => performAttack(), battleDelayMs);
          return;
        }

        // IMPORTANTE: resolveCombat é async, devemos aguardar antes de verificar gameOver
        Promise.resolve(
          game.resolveCombat(bestAttack.attacker, bestAttack.target),
        )
          .then(() => {
            // Verificar todas as condições antes de continuar atacando
            if (!game.gameOver && game.phase === "battle") {
              setTimeout(() => performAttack(), battleDelayMs);
            }
          })
          .catch((err) => {
            console.error("[Bot.playBattlePhase] resolveCombat error:", err);
          });
      } else {
        setTimeout(() => game.nextPhase(), battleDelayMs);
      }
    };

    performAttack();
  }

  evaluateBoard(gameOrState, perspectivePlayer) {
    return this.strategy.evaluateBoard(gameOrState, perspectivePlayer);
  }

  evaluateBoardV2(gameOrState, perspectivePlayer) {
    return this.strategy.evaluateBoardV2(gameOrState, perspectivePlayer);
  }

  generateMainPhaseActions(game) {
    const actions = this.strategy.generateMainPhaseActions(game);

    // 📊 Log de geração de ações
    if (botLogger) {
      const hand = this.hand || [];
      const field = this.field || [];
      const summonAvailable = (this.summonCount || 0) < 1;
      botLogger.logActionGeneration(
        this.id,
        game.turnCounter || 0,
        game.phase || "unknown",
        hand,
        field,
        summonAvailable,
        actions || [],
      );
    }

    return actions;
  }

  sequenceActions(actions) {
    return this.strategy.sequenceActions(actions);
  }

  getTributeRequirementFor(card, playerState) {
    return this.strategy.getTributeRequirementFor(card, playerState);
  }

  // Seleciona os melhores monstros para usar como tributo (os PIORES do campo)
  selectBestTributes(field, tributesNeeded, cardToSummon, context) {
    return this.strategy.selectBestTributes(
      field,
      tributesNeeded,
      cardToSummon,
      context,
    );
  }

  simulateMainPhaseAction(state, action) {
    return this.strategy.simulateMainPhaseAction(state, action);
  }

  simulateSpellEffect(state, card) {
    return this.strategy.simulateSpellEffect(state, card);
  }

  simulateBattle(state, attacker, target) {
    if (!attacker) return;
    if (attacker.cannotAttackThisTurn) return;
    if (attacker.position === "defense") return;

    let _extra = attacker.extraAttacks || 0;
    if (attacker.dynamicExtraAttacks?.source === "graveyard_count") {
      const dea = attacker.dynamicExtraAttacks;
      _extra = (state.bot?.graveyard || []).filter(c => c && c.name === dea.name).length;
      _extra -= 1;
    }
    const maxAttacks = 1 + _extra;
    const usedAttacks = attacker.attacksUsedThisTurn || 0;

    // Multi-attack mode allows more attacks
    const isMultiAttackMode = attacker.canAttackAllOpponentMonstersThisTurn;
    const multiAttackLimit = attacker.multiAttackLimit || 1;

    if (!isMultiAttackMode && usedAttacks >= maxAttacks) return;
    if (isMultiAttackMode && usedAttacks >= multiAttackLimit) return;

    const attackerOwner = state.bot;
    const defenderOwner = state.player;

    const attackStat = attacker.atk || 0;
    if (!target) {
      if (
        usedAttacks > 0 &&
        attacker.extraAttackTargetRestriction === "monster"
      ) {
        return;
      }
      defenderOwner.lp -= attackStat;
      attacker.attacksUsedThisTurn = usedAttacks + 1;
      // Multi-attack mode uses different limit
      const effectiveMax = isMultiAttackMode ? multiAttackLimit : maxAttacks;
      attacker.hasAttacked = attacker.attacksUsedThisTurn >= effectiveMax;
      return;
    }

    // 🎭 REGRA: Bot não pode ver DEF de monstros facedown
    // Estimar DEF baseado em média (1500) ao invés de usar valor real
    const targetStat =
      target.position === "attack"
        ? target.atk || 0
        : target.isFacedown
          ? 1500 // Estimativa: DEF médio de monstros
          : target.def || 0;
    if (target.position === "attack") {
      if (attackStat > targetStat) {
        defenderOwner.lp -= attackStat - targetStat;
        defenderOwner.graveyard.push(target);
        defenderOwner.field.splice(defenderOwner.field.indexOf(target), 1);
      } else if (attackStat < targetStat) {
        attackerOwner.lp -= targetStat - attackStat;
        attackerOwner.graveyard.push(attacker);
        attackerOwner.field.splice(attackerOwner.field.indexOf(attacker), 1);
      } else {
        attackerOwner.graveyard.push(attacker);
        defenderOwner.graveyard.push(target);
        attackerOwner.field.splice(attackerOwner.field.indexOf(attacker), 1);
        defenderOwner.field.splice(defenderOwner.field.indexOf(target), 1);
      }
    } else {
      // BUG #12 FIX: Target in defense position - consider piercing damage
      if (attackStat > targetStat) {
        // Attacker wins - destroy defender
        defenderOwner.graveyard.push(target);
        defenderOwner.field.splice(defenderOwner.field.indexOf(target), 1);
        // Check for piercing damage (inflict excess damage to LP)
        if (attacker.piercing) {
          const piercingDamage = attackStat - targetStat;
          defenderOwner.lp -= piercingDamage;
        }
      } else if (attackStat < targetStat) {
        // Attacker loses - take reflect damage
        attackerOwner.lp -= targetStat - attackStat;
      }
      // If attackStat === targetStat: tie, no damage, no destruction
    }
    attacker.attacksUsedThisTurn = usedAttacks + 1;
    // Multi-attack mode uses different limit
    const effectiveMax = isMultiAttackMode ? multiAttackLimit : maxAttacks;
    attacker.hasAttacked = attacker.attacksUsedThisTurn >= effectiveMax;
  }

  resolveHandIndexForAction(action, expectedKind) {
    if (!action) return -1;
    const hand = this.hand || [];
    const idHint = action.cardId ?? action.card?.id ?? null;
    const nameHint = action.cardName || action.card?.name || null;
    const expectedKinds = Array.isArray(expectedKind)
      ? expectedKind
      : expectedKind
        ? [expectedKind]
        : null;
    const matchesKind = (card) => {
      if (!card) return false;
      if (expectedKinds && !expectedKinds.includes(card.cardKind)) return false;
      return true;
    };
    const matchesById = (card) => {
      if (!matchesKind(card)) return false;
      if (idHint === null || idHint === undefined) return false;
      return card.id === idHint;
    };
    const matchesByName = (card) => {
      if (!matchesKind(card)) return false;
      if (!nameHint) return true;
      return card.name === nameHint;
    };

    if (Number.isInteger(action.index)) {
      const direct = hand[action.index];
      if (matchesById(direct)) return action.index;
      if (
        (idHint === null || idHint === undefined) &&
        !nameHint &&
        matchesKind(direct)
      ) {
        return action.index;
      }
      if (
        (idHint === null || idHint === undefined) &&
        nameHint &&
        matchesByName(direct)
      ) {
        return action.index;
      }
      if (nameHint && matchesByName(direct)) return action.index;
    }

    if (idHint !== null && idHint !== undefined) {
      const foundIndex = hand.findIndex((card) => matchesById(card));
      if (foundIndex >= 0) return foundIndex;
    }

    if (nameHint) {
      const foundIndex = hand.findIndex((card) => matchesByName(card));
      if (foundIndex >= 0) return foundIndex;
    }

    return -1;
  }

  tributeMatchesAltRequirement(card, alt) {
    if (!card || card.cardKind !== "monster" || !alt) return false;
    if (card.isFacedown) return false;
    if (alt.requiresName && card.name !== alt.requiresName) return false;
    if (alt.requiresType && card.type !== alt.requiresType) return false;
    return true;
  }

  canResolveSummonActionForCurrentState(action, game) {
    const resolvedIndex = this.resolveHandIndexForAction(action, "monster");
    if (resolvedIndex < 0) return false;
    const card = this.hand?.[resolvedIndex];
    if (!card || card.cardKind !== "monster") return false;
    if (card.cannotBeNormalSummonedOrSet) return false;
    if (card.summonRestrict === "shadow_heart_invocation_only") return false;

    const summonLimit = 1 + Math.max(0, Number(this.additionalNormalSummons || 0));
    if (Number(this.summonCount || 0) >= summonLimit) return false;

    const tributeInfo = this.getTributeRequirementFor(card, this) || {
      tributesNeeded: 0,
    };
    const tributesNeeded = Math.max(0, Number(tributeInfo.tributesNeeded || 0));
    const field = Array.isArray(this.field) ? this.field : [];
    if (field.length < tributesNeeded) return false;
    if (field.length - tributesNeeded + 1 > 5) return false;

    let tributeIndices = [];
    if (tributesNeeded > 0) {
      const opponent = game ? (this === game.player ? game.bot : game.player) : null;
      tributeIndices =
        typeof this.selectBestTributes === "function"
          ? this.selectBestTributes(field, tributesNeeded, card, {
              oppField: opponent?.field || [],
              game,
            })
          : field.map((_entry, index) => index).slice(0, tributesNeeded);
      if (!Array.isArray(tributeIndices) || tributeIndices.length < tributesNeeded) {
        return false;
      }
      const uniqueIndices = [...new Set(tributeIndices)].filter(
        (index) => Number.isInteger(index) && field[index],
      );
      if (uniqueIndices.length < tributesNeeded) return false;
      tributeIndices = uniqueIndices.slice(0, tributesNeeded);
      if (
        tributeInfo.usingAlt === true &&
        tributeInfo.alt &&
        !tributeIndices.some((index) =>
          this.tributeMatchesAltRequirement(field[index], tributeInfo.alt),
        )
      ) {
        return false;
      }
    }

    if (typeof game?.canPlaceCardOnField === "function") {
      const isFacedown = action.facedown === true;
      const excluded = tributeIndices.map((index) => field[index]).filter(Boolean);
      const placeCheck = game.canPlaceCardOnField(card, this, {
        zone: "monster",
        isFacedown,
        excludeCards: excluded,
        silent: true,
      });
      if (placeCheck?.ok === false) return false;
    }

    return true;
  }

  filterValidActionsForCurrentState(actions, game) {
    if (!Array.isArray(actions)) return [];
    return actions.filter((action) => {
      if (!action || !action.type) return false;
      if (action.type === "summon") {
        return this.canResolveSummonActionForCurrentState(action, game);
      }
      if (action.type === "spell") {
        return this.resolveHandIndexForAction(action, "spell") >= 0;
      }
      if (action.type === "set_spell_trap") {
        return this.resolveHandIndexForAction(action, ["spell", "trap"]) >= 0;
      }
      if (action.type === "spellTrapEffect") {
        const zoneIndex = Number.isInteger(action.zoneIndex)
          ? action.zoneIndex
          : action.index;
        const card = this.spellTrap?.[zoneIndex];
        return !!(card && card.cardKind === "spell");
      }
      if (action.type === "graveyardSpellEffect") {
        const graveyardIndex = Number.isInteger(action.graveyardIndex)
          ? action.graveyardIndex
          : this.graveyard.findIndex(
              (c) =>
                c &&
                (c.id === action.cardId ||
                  (!action.cardId && c.name === action.cardName)),
            );
        const card = this.graveyard?.[graveyardIndex];
        if (!card || card.cardKind !== "spell") return false;
        const activationContext = {
          ...(action.activationContext || {}),
          fromHand: false,
          activationZone: "graveyard",
          sourceZone: "graveyard",
        };
        const preview = game?.effectEngine?.canActivateSpellTrapEffectPreview?.(
          card,
          this,
          "graveyard",
          null,
          { activationContext },
        );
        return preview ? preview.ok !== false : true;
      }
      if (action.type === "special_summon_sanctum_protector") {
        const handIndex = this.resolveHandIndexForAction(action, "monster");
        if (handIndex < 0) return false;
        const materialIndex = Number.isInteger(action.materialIndex)
          ? action.materialIndex
          : this.field.findIndex(
              (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown,
            );
        const material = this.field[materialIndex];
        return !!(
          material &&
          material.name === "Luminarch Aegisbearer" &&
          !material.isFacedown
        );
      }
      if (action.type === "handIgnition") {
        return this.resolveHandIndexForAction(action, "monster") >= 0;
      }
      if (action.type === "graveyardMonsterEffect") {
        const graveyardIndex = Number.isInteger(action.graveyardIndex)
          ? action.graveyardIndex
          : this.graveyard.findIndex(
              (c) =>
                c &&
                (c.id === action.cardId ||
                  (!action.cardId && c.name === action.cardName)),
            );
        const card = this.graveyard?.[graveyardIndex];
        if (!card || card.cardKind !== "monster") return false;
        const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
          card,
          this,
          "graveyard",
          null,
          { activationContext: action.activationContext || {} },
        );
        return preview ? preview.ok !== false : true;
      }
      if (action.type === "monsterEffect") {
        const fieldIndex = Number.isInteger(action.fieldIndex)
          ? action.fieldIndex
          : this.field.findIndex(
              (c) =>
                c &&
                (c.id === action.cardId ||
                  (!action.cardId && c.name === action.cardName)),
            );
        const card = this.field?.[fieldIndex];
        if (!card || card.cardKind !== "monster" || card.isFacedown) {
          return false;
        }
        const preview = game?.effectEngine?.canActivateMonsterEffectPreview?.(
          card,
          this,
          "field",
          null,
          { activationContext: action.activationContext || {} },
        );
        return preview ? preview.ok !== false : true;
      }
      if (action.type === "ascension") {
        const material = this.field[action.materialIndex];
        if (!material) return false;
        if (game?.canUseAsAscensionMaterial) {
          const check = game.canUseAsAscensionMaterial(this, material);
          if (check && check.ok === false) return false;
        }
        return true;
      }
      if (action.type === "fieldEffect") {
        if (!this.fieldSpell) return false;
        const activationContext = {
          ...(action.activationContext || {}),
          fromHand: false,
          activationZone: "fieldSpell",
          sourceZone: "fieldSpell",
        };
        const preview = game?.effectEngine?.canActivateFieldSpellEffectPreview?.(
          this.fieldSpell,
          this,
          null,
          { activationContext },
        );
        return preview ? preview.ok !== false : true;
      }
      if (action.type === "position_change") {
        const target = Number.isInteger(action.fieldIndex)
          ? this.field?.[action.fieldIndex]
          : (this.field || []).find(
              (c) =>
                c &&
                (c.id === action.cardId ||
                  (!action.cardId && c.name === action.cardName)),
            );
        if (!target) return false;
        if (
          typeof game?.canChangePosition === "function" &&
          !game.canChangePosition(target)
        ) {
          return false;
        }
        if (
          action.toPosition &&
          (action.toPosition === "attack" || action.toPosition === "defense") &&
          target.position === action.toPosition
        ) {
          return false;
        }
        return true;
      }
      return true;
    });
  }

  async executeMainPhaseAction(game, action) {
    if (!action) return false;
    const baseGuard = game.canStartAction({
      actor: this,
      kind: "bot_main_action",
      phaseReq: ["main1", "main2"],
    });
    if (!baseGuard.ok) return false;

    // === ASCENSION SUMMON ===
    if (action.type === "ascension") {
      try {
        const material = this.field[action.materialIndex];
        if (!material) {
          console.log(
            `[Bot.executeMainPhaseAction] ❌ Ascension: material not found at index ${action.materialIndex}`,
          );
          return false;
        }

        console.log(
          `[Bot.executeMainPhaseAction] 🔥 Attempting Ascension: ${material.name} → ${action.ascensionCard.name}`,
        );

        const result = await game.performAscensionSummon(
          this,
          material,
          action.ascensionCard,
          {
            position:
              action.position ||
              this.getAscensionPositionPreference(
                action.ascensionCard,
                material,
                game,
              ),
          },
        );

        if (result?.success) {
          console.log(
            `[Bot.executeMainPhaseAction] ✅ Ascension successful: ${action.ascensionCard.name}`,
          );
          game.updateBoard();
          return true;
        } else {
          console.log(
            `[Bot.executeMainPhaseAction] ❌ Ascension failed:`,
            result?.reason,
          );
          return false;
        }
      } catch (e) {
        console.error(
          `[Bot.executeMainPhaseAction] ❌ Ascension error:`,
          e.message,
        );
        return false;
      }
    }

    if (action.type === "special_summon_sanctum_protector") {
      const resolvedIndex = this.resolveHandIndexForAction(action, "monster");
      if (resolvedIndex < 0) {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid Sanctum Protector action: no matching card in hand (index=${
            action.index
          }, card=${action.cardName || "unknown"})`,
        );
        return false;
      }

      const card = this.hand[resolvedIndex];
      if (!card || card.name !== "Luminarch Sanctum Protector") {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid Sanctum Protector action: card mismatch`,
        );
        return false;
      }

      const materialIndex = Number.isInteger(action.materialIndex)
        ? action.materialIndex
        : this.field.findIndex(
            (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown,
          );
      const material = this.field[materialIndex];
      if (
        !material ||
        material.name !== "Luminarch Aegisbearer" ||
        material.isFacedown
      ) {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid Sanctum Protector action: no face-up Aegisbearer`,
        );
        return false;
      }

      const sendResult = await game.moveCard(material, this, "graveyard", {
        fromZone: "field",
        contextLabel: "sanctum_protector_cost",
      });
      if (sendResult?.success === false) {
        console.log(
          `[Bot.executeMainPhaseAction] Sanctum Protector cost failed:`,
          sendResult?.reason,
        );
        return false;
      }

      const position = action.position === "attack" ? "attack" : "defense";
      const summonResult = await game.moveCard(card, this, "field", {
        fromZone: "hand",
        position,
        isFacedown: false,
        resetAttackFlags: true,
        contextLabel: "sanctum_protector_special",
      });
      if (summonResult?.success === false) {
        console.log(
          `[Bot.executeMainPhaseAction] Sanctum Protector summon failed:`,
          summonResult?.reason,
        );
        return false;
      }

      if (game && typeof game.emit === "function") {
        await game.emit("after_summon", {
          card,
          player: this,
          method: "special",
          fromZone: "hand",
        });
      }

      game.ui?.log(
        `Bot special summoned ${card.name} by sending ${material.name} to the GY.`,
      );
      game.updateBoard();
      return true;
    }

    if (action.type === "position_change") {
      const target = Number.isInteger(action.fieldIndex)
        ? this.field?.[action.fieldIndex]
        : (this.field || []).find(
            (c) =>
              c &&
              (c.id === action.cardId ||
                (!action.cardId && c.name === action.cardName)),
          );
      if (!target) return false;
      const newPosition =
        action.toPosition === "defense" ? "defense" : "attack";
      if (
        typeof game?.canChangePosition === "function" &&
        !game.canChangePosition(target)
      ) {
        return false;
      }
      if (target.position === newPosition) return false;
      game.changeMonsterPosition(target, newPosition);
      return true;
    }

    if (action.type === "summon") {
      const resolvedIndex = this.resolveHandIndexForAction(action, "monster");
      if (resolvedIndex < 0) {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid summon action: no matching monster in hand (index=${
            action.index
          }, card=${action.cardName || "unknown"})`,
        );
        return false;
      }
      const cardToSummon = this.hand[resolvedIndex];
      if (!this.canResolveSummonActionForCurrentState(action, game)) {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid summon action: summon requirements no longer met for ${cardToSummon?.name || action.cardName || "unknown"}`,
        );
        return false;
      }

      // Calcular tributos necessários e selecionar os melhores (piores monstros)
      const tributeInfo = this.getTributeRequirementFor(cardToSummon, this);
      let tributeIndices = null;

      if (tributeInfo.tributesNeeded > 0) {
        const opponent = this === game.player ? game.bot : game.player;
        tributeIndices = this.selectBestTributes(
          this.field,
          tributeInfo.tributesNeeded,
          cardToSummon,
          { oppField: opponent.field, game },
        );
      }

      const summonResult = await game.performNormalSummon(
        this,
        resolvedIndex,
        action.position,
        action.facedown,
        tributeIndices,
      );
      if (summonResult) {
        // Handle both old (card) and new ({card, tributes}) return formats
        const card = summonResult.card || summonResult;
        const tributes = summonResult.tributes || [];

        game.ui?.log(
          `Bot summons ${action.facedown ? "a monster in defense" : card.name}`,
        );
        game.updateBoard();

        // Let the summon become visible before resolving on-summon triggers.
        const isFacedownSet = action.facedown === true;
        if (
          !isFacedownSet &&
          typeof game?.waitForAiPresentationStep === "function"
        ) {
          await game.waitForAiPresentationStep(this);
        }

        // Emit after_summon event for trigger effects (e.g., Void Mage search)
        // Only trigger if summoned face-up (facedown set doesn't trigger "when Normal Summoned" effects)
        if (!isFacedownSet && game && typeof game.emit === "function") {
          await game.emit("after_summon", {
            card,
            player: this,
            method: tributeInfo.tributesNeeded > 0 ? "tribute" : "normal",
            fromZone: "hand",
            tributes: tributes,
          });
        }

        game.updateBoard();
        return true;
      }
      return false;
    }

    if (action.type === "spell") {
      const resolvedIndex = this.resolveHandIndexForAction(action, "spell");
      if (resolvedIndex < 0) {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid spell action: no matching spell in hand (index=${
            action.index
          }, card=${action.cardName || "unknown"})`,
        );
        return false;
      }
      const card = this.hand[resolvedIndex];
      const actionActivationContext = action.activationContext || {};

      console.log(
        `[Bot.executeMainPhaseAction] 📝 Attempting spell: ${card.name}`,
      );

      if (
        game.effectEngine &&
        typeof game.effectEngine.canActivateSpellFromHandPreview === "function"
      ) {
        const preview = game.effectEngine.canActivateSpellFromHandPreview(
          card,
          this,
          { activationContext: actionActivationContext },
        );
        console.log(`[Bot.executeMainPhaseAction] 🔍 Preview check:`, preview);
        if (preview && !preview.ok) {
          console.log(
            `[Bot.executeMainPhaseAction] ❌ Preview rejected:`,
            preview.reason,
          );
          return false;
        }
      }

      const activationEffect =
        game.effectEngine?.getSpellTrapActivationEffect?.(card, {
          fromHand: true,
        });

      const pipelineResult = await game.runActivationPipeline({
        card,
        owner: this,
        selectionKind: "spellTrapEffect",
        selectionMessage: "Select target(s) for the spell effect.",
        guardKind: "bot_spell_from_hand",
        phaseReq: ["main1", "main2"],
        preview: () =>
          game.effectEngine?.canActivateSpellFromHandPreview?.(card, this, {
            activationContext: actionActivationContext,
          }),
        commit: () => game.commitCardActivationFromHand(this, resolvedIndex),
        activationContext: {
          ...actionActivationContext,
          fromHand: true,
          sourceZone: "hand",
        },
        oncePerTurn: {
          card,
          player: this,
          effect: activationEffect,
        },
        activate: (chosen, ctx, zone, resolvedCard) =>
          game.effectEngine.activateSpellTrapEffect(
            resolvedCard,
            this,
            chosen,
            zone,
            ctx,
          ),
        finalize: async (result, info) => {
          await game.finalizeSpellCardActivation(result, info, {
            owner: this,
            fromHand: true,
            effect: activationEffect,
            placementLog: `Bot places ${info.card.name}.`,
            activationLog: `Bot activates ${info.card.name}`,
          });
        },
      });
      // Pipeline retorna false, null, ou {success: false} quando falha
      return (
        pipelineResult !== false &&
        pipelineResult !== null &&
        pipelineResult?.success !== false
      );
    }

    if (action.type === "set_spell_trap") {
      const resolvedIndex = this.resolveHandIndexForAction(action, [
        "spell",
        "trap",
      ]);
      if (resolvedIndex < 0) {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid set action: no matching card in hand (index=${
            action.index
          }, card=${action.cardName || "unknown"})`,
        );
        return false;
      }
      const card = this.hand[resolvedIndex];
      const result = game.setSpellOrTrap(card, resolvedIndex, this);
      if (result && result.ok === false) {
        console.log(
          `[Bot.executeMainPhaseAction] Set spell/trap failed:`,
          result.reason,
        );
        return false;
      }
      game.ui?.log?.(`Bot sets a card.`);
      game.updateBoard();
      return true;
    }

    if (action.type === "spellTrapEffect") {
      const zoneIndex = Number.isInteger(action.zoneIndex)
        ? action.zoneIndex
        : action.index;
      const card = this.spellTrap?.[zoneIndex];
      if (!card || card.cardKind !== "spell") {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid spellTrapEffect action: no spell at index ${zoneIndex}`,
        );
        return false;
      }

      const activationEffect =
        game.effectEngine?.getSpellTrapActivationEffect?.(card, {
          fromHand: false,
        });
      const actionActivationContext = action.activationContext || {};

      const activationContext = {
        ...actionActivationContext,
        fromHand: false,
        activationZone: "spellTrap",
        sourceZone: "spellTrap",
      };

      const pipelineResult = await game.runActivationPipeline({
        card,
        owner: this,
        activationZone: "spellTrap",
        activationContext,
        selectionKind: "spellTrapEffect",
        selectionMessage: "Select target(s) for the spell effect.",
        guardKind: "bot_spelltrap_effect",
        phaseReq: ["main1", "main2"],
        preview: () =>
          game.effectEngine?.canActivateSpellTrapEffectPreview?.(
            card,
            this,
            "spellTrap",
            null,
            { activationContext },
          ),
        oncePerTurn: {
          card,
          player: this,
          effect: activationEffect,
        },
        activate: (chosen, ctx, zone) =>
          game.effectEngine.activateSpellTrapEffect(
            card,
            this,
            chosen,
            zone,
            ctx,
          ),
        finalize: async (result, info) => {
          if (result.placementOnly) {
            game.ui?.log?.(`Bot places ${info.card.name}.`);
          } else {
            await game.finalizeSpellTrapActivation(
              info.card,
              this,
              info.activationZone,
            );
            game.ui?.log?.(`Bot activates ${info.card.name}`);
          }
          game.updateBoard();
        },
      });

      return !!pipelineResult && pipelineResult.success !== false;
    }

    if (action.type === "graveyardSpellEffect") {
      const graveyardIndex = Number.isInteger(action.graveyardIndex)
        ? action.graveyardIndex
        : this.graveyard.findIndex(
            (c) =>
              c &&
              (c.id === action.cardId ||
                (!action.cardId && c.name === action.cardName)),
          );
      const card = this.graveyard?.[graveyardIndex];
      if (!card || card.cardKind !== "spell") {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid graveyardSpellEffect action: no spell at index ${graveyardIndex}`,
        );
        return false;
      }

      const graveyardEffect =
        game.effectEngine?.getSpellTrapActivationEffect?.(card, {
          fromHand: false,
        });
      if (!graveyardEffect) {
        console.log(
          `[Bot.executeMainPhaseAction] No graveyard spell ignition effect found for ${card.name}`,
        );
        return false;
      }

      const actionActivationContext = action.activationContext || {};
      const activationContext = {
        ...actionActivationContext,
        fromHand: false,
        activationZone: "graveyard",
        sourceZone: "graveyard",
        autoSelectTargets: actionActivationContext.autoSelectTargets !== false,
        autoSelectSingleTarget:
          actionActivationContext.autoSelectSingleTarget !== false,
      };

      const pipelineResult = await game.runActivationPipeline({
        card,
        owner: this,
        activationZone: "graveyard",
        activationContext,
        selectionKind: "graveyardEffect",
        selectionMessage: "Select target(s) for the graveyard spell effect.",
        guardKind: "bot_graveyard_spell_effect",
        phaseReq: ["main1", "main2"],
        preview: () =>
          game.effectEngine?.canActivateSpellTrapEffectPreview?.(
            card,
            this,
            "graveyard",
            null,
            { activationContext },
          ),
        oncePerTurn: {
          card,
          player: this,
          effect: graveyardEffect,
        },
        activate: (chosen, ctx, zone) =>
          game.effectEngine.activateSpellTrapEffect(
            card,
            this,
            chosen,
            zone,
            ctx,
          ),
        finalize: () => {
          game.ui?.log?.(`Bot activates ${card.name}'s effect from graveyard`);
          game.updateBoard();
        },
      });

      return (
        pipelineResult !== false &&
        pipelineResult !== null &&
        pipelineResult?.success !== false
      );
    }

    if (action.type === "fieldEffect" && this.fieldSpell) {
      const fieldSpell = this.fieldSpell;
      const actionActivationContext = action.activationContext || {};
      const activationContext = {
        ...actionActivationContext,
        fromHand: false,
        activationZone: "fieldSpell",
        sourceZone: "fieldSpell",
      };
      const activationEffect =
        game.effectEngine?.getFieldSpellActivationEffect?.(fieldSpell);
      const pipelineResult = await game.runActivationPipeline({
        card: fieldSpell,
        owner: this,
        activationZone: "fieldSpell",
        activationContext,
        selectionKind: "fieldSpell",
        selectionMessage: "Select target(s) for the field spell effect.",
        guardKind: "bot_fieldspell_effect",
        phaseReq: ["main1", "main2"],
        preview: () =>
          game.effectEngine?.canActivateFieldSpellEffectPreview?.(
            fieldSpell,
            this,
            null,
            { activationContext },
          ),
        oncePerTurn: {
          card: fieldSpell,
          player: this,
          effect: activationEffect,
        },
        activate: (selections, ctx) =>
          game.effectEngine.activateFieldSpell(
            fieldSpell,
            this,
            selections,
            ctx,
          ),
        finalize: () => {
          game.ui?.log?.(`Bot activates ${fieldSpell.name}'s effect`);
          game.updateBoard();
        },
      });
      // Pipeline retorna false, null, ou {success: false} quando falha
      return (
        pipelineResult !== false &&
        pipelineResult !== null &&
        pipelineResult?.success !== false
      );
    }

    if (action.type === "monsterEffect") {
      const fieldIndex = Number.isInteger(action.fieldIndex)
        ? action.fieldIndex
        : this.field.findIndex(
            (c) =>
              c &&
              (c.id === action.cardId ||
                (!action.cardId && c.name === action.cardName)),
          );
      const card = this.field?.[fieldIndex];
      if (!card || card.cardKind !== "monster" || card.isFacedown) {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid monsterEffect action: no face-up monster at index ${fieldIndex}`,
        );
        return false;
      }

      const actionActivationContext = action.activationContext || {};
      const activationContext = {
        ...actionActivationContext,
        fromHand: false,
        activationZone: "field",
        sourceZone: "field",
        autoSelectTargets: actionActivationContext.autoSelectTargets !== false,
      };
      const activationEffect = (card.effects || []).find(
        (e) =>
          e &&
          e.timing === "ignition" &&
          (!e.requireZone || e.requireZone === "field"),
      );

      const pipelineResult = await game.runActivationPipeline({
        card,
        owner: this,
        activationZone: "field",
        activationContext,
        selectionKind: "monsterEffect",
        selectionMessage: "Select target(s) for the monster effect.",
        guardKind: "bot_monster_effect",
        phaseReq: ["main1", "main2"],
        preview: () =>
          game.effectEngine?.canActivateMonsterEffectPreview?.(
            card,
            this,
            "field",
            null,
            { activationContext },
          ),
        oncePerTurn: {
          card,
          player: this,
          effect: activationEffect,
        },
        activate: (chosen, ctx, zone) =>
          game.effectEngine.activateMonsterEffect(
            card,
            this,
            chosen,
            zone,
            ctx,
          ),
        finalize: () => {
          game.ui?.log?.(`Bot activates ${card.name}'s effect`);
          game.updateBoard();
        },
      });

      return (
        pipelineResult !== false &&
        pipelineResult !== null &&
        pipelineResult?.success !== false
      );
    }

    if (action.type === "graveyardMonsterEffect") {
      const graveyardIndex = Number.isInteger(action.graveyardIndex)
        ? action.graveyardIndex
        : this.graveyard.findIndex(
            (c) =>
              c &&
              (c.id === action.cardId ||
                (!action.cardId && c.name === action.cardName)),
          );
      const card = this.graveyard?.[graveyardIndex];
      if (!card || card.cardKind !== "monster") {
        console.log(
          `[Bot.executeMainPhaseAction] Invalid graveyardMonsterEffect action: no monster at index ${graveyardIndex}`,
        );
        return false;
      }

      const graveyardEffect =
        game.effectEngine?.getMonsterIgnitionEffect?.(card, "graveyard") ||
        (card.effects || []).find(
          (e) => e && e.timing === "ignition" && e.requireZone === "graveyard",
        );
      if (!graveyardEffect) {
        console.log(
          `[Bot.executeMainPhaseAction] No graveyard ignition effect found for ${card.name}`,
        );
        return false;
      }

      const actionActivationContext = action.activationContext || {};
      const activationContext = {
        ...actionActivationContext,
        fromHand: false,
        activationZone: "graveyard",
        sourceZone: "graveyard",
        autoSelectTargets: actionActivationContext.autoSelectTargets !== false,
        autoSelectSingleTarget:
          actionActivationContext.autoSelectSingleTarget !== false,
      };

      const pipelineResult = await game.runActivationPipeline({
        card,
        owner: this,
        activationZone: "graveyard",
        activationContext,
        selectionKind: "graveyardEffect",
        selectionMessage: "Select target(s) for the graveyard effect.",
        guardKind: "bot_graveyard_monster_effect",
        phaseReq: ["main1", "main2"],
        preview: () =>
          game.effectEngine?.canActivateMonsterEffectPreview?.(
            card,
            this,
            "graveyard",
            null,
            { activationContext },
          ),
        oncePerTurn: {
          card,
          player: this,
          effect: graveyardEffect,
        },
        activate: (chosen, ctx) =>
          game.effectEngine.activateMonsterFromGraveyard(
            card,
            this,
            chosen,
            ctx,
          ),
        finalize: () => {
          game.ui?.log?.(`Bot activates ${card.name}'s effect from graveyard`);
          game.updateBoard();
        },
      });

      return (
        pipelineResult !== false &&
        pipelineResult !== null &&
        pipelineResult?.success !== false
      );
    }

    // Handler para ativação de efeitos ignition de monstros na mão
    if (action.type === "handIgnition") {
      const resolvedIndex = this.resolveHandIndexForAction(action, "monster");
      if (resolvedIndex < 0) return false;
      const card = this.hand[resolvedIndex];

      console.log(
        `[Bot.executeMainPhaseAction] 🔥 Attempting hand ignition: ${card.name}`,
      );

      // Verificar se o efeito pode ser ativado
      const handIgnitionEffect = (card.effects || []).find(
        (e) => e && e.timing === "ignition" && e.requireZone === "hand",
      );
      if (!handIgnitionEffect) {
        console.log(
          `[Bot.executeMainPhaseAction] ❌ No hand ignition effect found`,
        );
        return false;
      }

      const actionActivationContext = action.activationContext || {};
      const activationContext = {
        ...actionActivationContext,
        fromHand: true,
        activationZone: "hand",
        sourceZone: "hand",
        autoSelectTargets: actionActivationContext.autoSelectTargets !== false,
      };

      const pipelineResult = await game.runActivationPipeline({
        card,
        owner: this,
        activationZone: "hand",
        activationContext,
        selectionKind: "monsterEffect",
        selectionMessage: "Select target(s) for the monster effect.",
        guardKind: "bot_hand_ignition",
        phaseReq: ["main1", "main2"],
        oncePerTurn: {
          card,
          player: this,
          effect: handIgnitionEffect,
        },
        activate: (chosen, ctx, zone) =>
          game.effectEngine.activateMonsterEffect(
            card,
            this,
            chosen,
            "hand",
            ctx,
          ),
        finalize: () => {
          game.ui?.log?.(`Bot activates ${card.name}'s effect from hand`);
          game.updateBoard();
        },
      });
      // Pipeline retorna false, null, ou {success: false} quando falha
      return (
        pipelineResult !== false &&
        pipelineResult !== null &&
        pipelineResult?.success !== false
      );
    }

    return false;
  }

  cloneGameState(game) {
    const clonePlayer = (p) => {
      return {
        id: p.id,
        lp: p.lp,
        hand: p.hand.map((c) => ({ ...c })),
        field: p.field.map((c) => ({ ...c })),
        graveyard: p.graveyard.map((c) => ({ ...c })),
        deck: p.deck ? p.deck.map((c) => ({ ...c })) : [],
        extraDeck: p.extraDeck ? p.extraDeck.map((c) => ({ ...c })) : [],
        banished: p.banished ? p.banished.map((c) => ({ ...c })) : [],
        fieldSpell: p.fieldSpell ? { ...p.fieldSpell } : null,
        spellTrap: p.spellTrap ? p.spellTrap.map((c) => ({ ...c })) : [],
        summonCount: p.summonCount || 0,
        additionalNormalSummons: p.additionalNormalSummons || 0,
        controllerType: p.controllerType,
      };
    };
    const opponent = this.resolveOpponent(game) || game.player;

    return {
      player: clonePlayer(opponent),
      bot: clonePlayer(this),
      turn: game.turn,
      phase: game.phase,
      turnCounter: game.turnCounter || 0,
      _isPerspectiveState: true,
      _gameRef: game,
      // Clone once-per-turn tracking from effectEngine if available
      usedThisTurn: game.effectEngine?.usedThisTurn
        ? new Map(game.effectEngine.usedThisTurn)
        : new Map(),
    };
  }

  async tryAscensionIfAvailable(game) {
    try {
      const choices = [];
      const materials = (this.field || []).filter(
        (m) => m && m.cardKind === "monster" && !m.isFacedown,
      );
      for (const material of materials) {
        const matCheck = game.canUseAsAscensionMaterial(this, material);
        if (!matCheck.ok) continue;
        const candidates =
          game.getAscensionCandidatesForMaterial(this, material) || [];
        if (!candidates.length) continue;
        // Filter by requirements
        const eligible = candidates.filter(
          (asc) => game.checkAscensionRequirements(this, asc).ok,
        );
        if (!eligible.length) continue;
        for (const ascensionCard of eligible) {
          choices.push({ material, ascensionCard });
        }
      }

      if (!choices.length) return false;

      const opponent = this.resolveOpponent(game);
      const strategicChoice = this.strategy?.selectAutomaticAscension?.({
        choices,
        game,
        bot: this,
        opponent,
      });
      if (strategicChoice?.skip === true) {
        return false;
      }

      let selected = null;
      if (strategicChoice?.material && strategicChoice?.ascensionCard) {
        selected = {
          material: strategicChoice.material,
          ascensionCard: strategicChoice.ascensionCard,
          position: strategicChoice.position,
        };
      }

      if (!selected) {
        const firstMaterial = choices[0].material;
        const eligibleForFirstMaterial = choices
          .filter((choice) => choice.material === firstMaterial)
          .map((choice) => choice.ascensionCard);
        selected = {
          material: firstMaterial,
          ascensionCard: this.selectBestAscension(
            eligibleForFirstMaterial,
            firstMaterial,
            game,
          ),
        };
      }

      const position =
        selected.position ||
        this.strategy?.chooseAutomaticAscensionPosition?.({
          material: selected.material,
          ascensionCard: selected.ascensionCard,
          game,
          bot: this,
          opponent,
        }) ||
        this.getAscensionPositionPreference(
          selected.ascensionCard,
          selected.material,
          game,
        );

      const res = await game.performAscensionSummon(
        this,
        selected.material,
        selected.ascensionCard,
        { position },
      );
      if (res?.success) {
        return true;
      }
    } catch (e) {
      // Silent fail; bot ascension is opportunistic
    }
    return false;
  }

  /**
   * Seleciona a melhor Ascensão baseada no contexto do jogo.
   * @param {Array} eligible - Lista de ascensões elegíveis
   * @param {Object} material - Monstro material
   * @param {Object} game - Instância do jogo
   * @returns {Object} Melhor ascensão
   */
  selectBestAscension(eligible, material, game) {
    if (eligible.length === 1) return eligible[0];

    const opponent = this.resolveOpponent(game);
    const oppField = opponent?.field || [];
    const oppHasThreats = oppField.some((m) => (m?.atk || 0) >= 2000);
    const oppFieldSize = oppField.length;

    // Calcular score para cada ascensão
    const scored = eligible.map((asc) => {
      let score = 0;

      // Base: ATK
      score += (asc.atk || 0) / 100;

      // Shadow-Heart Armored Arctroth (75): melhor contra ameaças únicas fortes
      if (asc.id === 75 && oppHasThreats) {
        score += 5; // Efeito de zerar ATK/DEF é ótimo contra bosses
      }

      // Priorizar ATK maior se não há contexto específico
      if (!oppHasThreats && oppFieldSize === 0) {
        score += (asc.atk || 0) / 200; // Peso extra para ATK se campo vazio
      }

      return { asc, score };
    });

    // Ordenar por score decrescente e retornar o melhor
    scored.sort((a, b) => b.score - a.score);
    return scored[0].asc;
  }

  getAscensionPositionPreference(ascensionCard, _material, game) {
    if (ascensionCard?.name !== "Metal Armored Dragon") {
      return ascensionCard?.ascension?.position || "choice";
    }

    const opponent = this.resolveOpponent(game);
    const oppStrongestATK = (opponent?.field || []).reduce(
      (max, monster) => Math.max(max, monster?.atk || 0),
      0,
    );

    if (oppStrongestATK >= (ascensionCard.atk || 0)) {
      return "defense";
    }

    return "attack";
  }
}
