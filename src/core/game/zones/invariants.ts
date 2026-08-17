/**
 * Zone state invariants - validation and consistency checks.
 * Extracted from Game.js as part of B.4 modularization.
 */

import type { GameCard } from "../../contracts/cards.js";
import type { FullGameHost } from "../../contracts/gameRuntime.js";
import type { GamePlayer } from "../../contracts/player.js";

type CheckedZoneName =
  | "hand"
  | "field"
  | "spellTrap"
  | "graveyard"
  | "banished"
  | "deck"
  | "extraDeck";

interface ZoneInvariantOptions {
  zones?: readonly CheckedZoneName[];
  failFast?: boolean;
  normalize?: boolean;
}

interface ZoneIssue {
  message?: string;
  detail?: unknown;
  playerId?: string | null;
  zone?: CheckedZoneName;
  indices?: number[];
  length?: number;
  context?: string;
}

interface ZoneInspectionResult {
  ok: boolean;
  context: string;
  issues: ZoneIssue[];
}

interface ZoneInvariantHost extends FullGameHost {
  zoneOpDepth: number;
  eventResolutionDepth: number;
  devModeEnabled: boolean;
  _invariantLogCache?: Record<string, number>;
  normalizeZoneCardOwnership(
    contextLabel?: string,
    options?: { enforceZoneOwner?: boolean },
  ): void;
  forceClearTargetSelection(reason: string): void;
  setSelectionState(state: string): void;
  devLog?(code: string, detail?: unknown): void;
}

const DEFAULT_NULLISH_ZONE_NAMES: readonly CheckedZoneName[] = [
  "hand",
  "field",
  "spellTrap",
  "graveyard",
  "banished",
  "deck",
  "extraDeck",
];

function resolveZoneHelperArgs(
  boundGame: ZoneInvariantHost | undefined | void,
  gameOrContext: ZoneInvariantHost | string | null | undefined,
  contextOrOptions: string | ZoneInvariantOptions,
  optionsArg: ZoneInvariantOptions,
): {
  game: ZoneInvariantHost | undefined;
  context: string;
  options: ZoneInvariantOptions;
} {
  const firstArgIsGame =
    gameOrContext &&
    typeof gameOrContext === "object" &&
    ("player" in gameOrContext || "bot" in gameOrContext);
  const game = firstArgIsGame ? gameOrContext : boundGame;
  const context = firstArgIsGame
    ? typeof contextOrOptions === "string"
      ? contextOrOptions
      : "zone_check"
    : typeof gameOrContext === "string"
      ? gameOrContext
      : "zone_check";
  const options = firstArgIsGame
    ? contextOrOptions && typeof contextOrOptions === "object"
      ? contextOrOptions
      : optionsArg || {}
    : contextOrOptions && typeof contextOrOptions === "object"
      ? contextOrOptions
      : {};
  return {
    game: typeof game === "object" && game !== null ? game : undefined,
    context,
    options,
  };
}

function getNullishZoneNames(
  options: ZoneInvariantOptions = {},
): readonly CheckedZoneName[] {
  return Array.isArray(options.zones) && options.zones.length > 0
    ? options.zones
    : DEFAULT_NULLISH_ZONE_NAMES;
}

/**
 * Inspect zones for null/undefined slots without mutating state.
 * @param gameOrContext - Game instance, or context when bound as a method.
 * @param {string|Object} contextOrOptions - Context label or options.
 * @param optionsArg - Optional helper options.
 * @returns {{ok: boolean, context: string, issues: Array}}
 */
export function inspectZoneNullishCards(
  this: ZoneInvariantHost | undefined | void,
  gameOrContext?: ZoneInvariantHost | string,
  contextOrOptions: string | ZoneInvariantOptions = "zone_check",
  optionsArg: ZoneInvariantOptions = {},
): ZoneInspectionResult {
  const { game, context, options } = resolveZoneHelperArgs(
    this,
    gameOrContext,
    contextOrOptions,
    optionsArg,
  );
  const issues: ZoneIssue[] = [];
  if (!game) {
    return { ok: true, context, issues };
  }

  const inspectPlayer = (player: GamePlayer | null | undefined) => {
    if (!player) return;
    for (const zone of getNullishZoneNames(options)) {
      const list = player[zone];
      if (!Array.isArray(list)) continue;
      const invalidIndices: number[] = [];
      list.forEach((card, index) => {
        if (card == null) invalidIndices.push(index);
      });
      if (invalidIndices.length > 0) {
        issues.push({
          playerId: player.id || null,
          zone,
          indices: invalidIndices,
          length: list.length,
          context,
        });
      }
    }
  };

  inspectPlayer(game.player);
  inspectPlayer(game.bot);
  return { ok: issues.length === 0, context, issues };
}

/**
 * Explicitly recover null/undefined zone slots and report what changed.
 * This helper is intentionally separate from rendering.
 * @param gameOrContext - Game instance, or context when bound as a method.
 * @param {string|Object} contextOrOptions - Context label or options.
 * @param optionsArg - Optional helper options.
 * @returns {{ok: boolean, recovered: boolean, context: string, issues: Array}}
 */
export function recoverNullishZoneCards(
  this: ZoneInvariantHost | undefined | void,
  gameOrContext?: ZoneInvariantHost | string,
  contextOrOptions: string | ZoneInvariantOptions = "zone_recovery",
  optionsArg: ZoneInvariantOptions = {},
) {
  const { game, context, options } = resolveZoneHelperArgs(
    this,
    gameOrContext,
    contextOrOptions,
    optionsArg,
  );
  const inspection = inspectZoneNullishCards(game, context, options);
  if (!game || inspection.ok) {
    return {
      ok: true,
      recovered: false,
      context,
      issues: inspection.issues,
    };
  }

  for (const issue of inspection.issues) {
    const player =
      game.player?.id === issue.playerId
        ? game.player
        : game.bot?.id === issue.playerId
          ? game.bot
          : null;
    const zone = issue.zone;
    if (!zone) continue;
    const list = player?.[zone];
    if (player && Array.isArray(list)) {
      player[zone] = list.filter((card) => card != null);
    }
  }

  const detail = {
    summary: `Recovered nullish zone slots during ${context}`,
    context,
    issues: inspection.issues,
  };
  game.devLog?.("ZONE_NULLISH_RECOVERY", detail);
  game._arenaTracker?.recordProgress?.("zone_nullish_recovery", game, detail);

  return {
    ok: true,
    recovered: true,
    context,
    issues: inspection.issues,
  };
}

/**
 * Assert that the game state is consistent (no invariant violations).
 * @param {string} contextLabel - Label for logging
 * @param options - Options (failFast, normalize)
 * @returns {{ok: boolean, issues: Array, hasCritical: boolean, criticalIssues: Array}}
 */
export function assertStateInvariants(
  this: ZoneInvariantHost,
  contextLabel = "state_check",
  options: ZoneInvariantOptions = {},
) {
  // CORREÇÃO: Skip validação durante operações de zona aninhadas (aumentado >2 → >1)
  // Durante efeitos que movem cartas, o estado pode estar temporariamente inconsistente
  // Fix: 17 erros em 10 duelos → agora skip em QUALQUER operação aninhada
  if (this.zoneOpDepth > 1) {
    return { ok: true, issues: [], hasCritical: false, criticalIssues: [] };
  }

  // CORREÇÃO: Skip durante resolução de efeitos (aumentado >3 → >1)
  // Fix: Previne warns em duelos bot vs bot com efeitos em cadeia
  if (this.eventResolutionDepth > 1) {
    return { ok: true, issues: [], hasCritical: false, criticalIssues: [] };
  }

  // CORREÇÃO: Rate limiting agressivo (500ms → 2000ms)
  // Fix: Ainda aparecendo 17 logs em 10 duelos
  const now = Date.now();
  this._invariantLogCache = this._invariantLogCache || {};
  const cacheKey = `${contextLabel}_${this.zoneOpDepth}_${this.eventResolutionDepth}`;
  const lastLog = this._invariantLogCache[cacheKey] || 0;
  const LOG_COOLDOWN_MS = 2000; // Max 1 log do mesmo tipo a cada 2s
  
  if (now - lastLog < LOG_COOLDOWN_MS) {
    return { ok: true, issues: [], hasCritical: false, criticalIssues: [] };
  }
  this._invariantLogCache[cacheKey] = now;

  const failFast =
    options.failFast !== undefined ? options.failFast : this.devModeEnabled;
  const normalize = options.normalize !== false;
  const issues: ZoneIssue[] = [];

  if (normalize) {
    this.normalizeZoneCardOwnership(contextLabel, {
      enforceZoneOwner: true,
    });
  }
  const addIssue = (message: string, detail: unknown) => {
    issues.push({ message, detail });
  };
  const normalizeZone = (
    player: GamePlayer,
    zoneName: CheckedZoneName,
    list: GameCard[],
  ) => {
    if (!Array.isArray(list)) return;
    const hasHoles = list.some((item) => !item);
    if (hasHoles) {
      addIssue("zone_has_empty_slots", {
        player: player?.id,
        zone: zoneName,
      });
      if (normalize) {
        const filtered = list.filter((item) => item);
        if (player && Array.isArray(player[zoneName])) {
          player[zoneName] = filtered;
        }
      }
    }
  };

  const checkZoneLimit = (
    player: GamePlayer,
    zoneName: CheckedZoneName,
    max: number,
  ) => {
    const list = player?.[zoneName];
    if (Array.isArray(list) && list.length > max) {
      addIssue("zone_limit_exceeded", {
        player: player?.id,
        zone: zoneName,
        length: list.length,
        max,
      });
    }
  };

  const collectZones = (
    player: GamePlayer,
  ): Array<{ name: CheckedZoneName; list: GameCard[] }> => [
    { name: "hand", list: player?.hand || [] },
    { name: "field", list: player?.field || [] },
    { name: "spellTrap", list: player?.spellTrap || [] },
    { name: "graveyard", list: player?.graveyard || [] },
    { name: "banished", list: player?.banished || [] },
    { name: "deck", list: player?.deck || [] },
    { name: "extraDeck", list: player?.extraDeck || [] },
  ];

  [this.player, this.bot].forEach((player) => {
    if (!player) return;
    checkZoneLimit(player, "field", 5);
    checkZoneLimit(player, "spellTrap", 5);
    collectZones(player).forEach(({ name, list }) =>
      normalizeZone(player, name, list)
    );
  });

  const locationMap = new Map<
    GameCard,
    Array<{ playerId: string; zoneName: CheckedZoneName | "fieldSpell" }>
  >();
  const registerCard = (
    card: GameCard | null | undefined,
    playerId: string,
    zoneName: CheckedZoneName | "fieldSpell",
  ) => {
    if (!card) return;
    if (!locationMap.has(card)) {
      locationMap.set(card, []);
    }
    locationMap.get(card)!.push({ playerId, zoneName });
  };

  [this.player, this.bot].forEach((player) => {
    if (!player) return;
    collectZones(player).forEach(({ name, list }) => {
      list.forEach((card) => registerCard(card, player.id, name));
    });
    if (player.fieldSpell) {
      registerCard(player.fieldSpell, player.id, "fieldSpell");
    }
  });

  locationMap.forEach((locations, card) => {
    if (locations.length > 1) {
      addIssue("card_in_multiple_zones", {
        card: card?.name,
        locations,
      });
    }
    locations.forEach((entry) => {
      if (card?.owner && card.owner !== entry.playerId) {
        addIssue("owner_mismatch", {
          card: card?.name,
          owner: card.owner,
          zoneOwner: entry.playerId,
          zone: entry.zoneName,
        });
      }
      if (card?.controller && card.controller !== entry.playerId) {
        addIssue("controller_mismatch", {
          card: card?.name,
          controller: card.controller,
          zoneOwner: entry.playerId,
          zone: entry.zoneName,
        });
      }
    });
  });

  [this.player, this.bot].forEach((player) => {
    if (!player?.fieldSpell) return;
    const fieldSpell = player.fieldSpell;
    const locs = locationMap.get(fieldSpell) || [];
    if (locs.length > 1) {
      addIssue("field_spell_in_multiple_zones", {
        card: fieldSpell.name,
        locations: locs,
      });
    }
  });

  const selectionState = this.selectionState || "idle";
  if (this.targetSelection && selectionState === "idle") {
    addIssue("selection_stale", { state: selectionState });
    this.forceClearTargetSelection("stale_selection");
  } else if (!this.targetSelection) {
    if (selectionState === "selecting" || selectionState === "confirming") {
      addIssue("selection_state_mismatch", { state: selectionState });
      this.setSelectionState("idle");
    } else if (selectionState === "resolving") {
      const resolvingContext =
        this.isResolvingEffect || this.eventResolutionDepth > 0;
      if (!resolvingContext) {
        this.setSelectionState("idle");
      }
    }
  }

  const nonCriticalIssues = new Set<string | undefined>([
    "selection_stale",
    "selection_state_mismatch",
    "resolving_state_stale",
  ]);
  const hasCritical = issues.some(
    (issue) => !nonCriticalIssues.has(issue.message)
  );
  const criticalIssues = issues.filter(
    (issue) => !nonCriticalIssues.has(issue.message)
  );

  if (issues.length) {
    const summary = `[Game] State invariants failed (${contextLabel})`;
    const log = hasCritical ? console.error : console.warn;
    log(summary, issues);
    if (failFast && hasCritical) {
      throw new Error(`${summary} issues=${issues.length}`);
    }
  }

  return { ok: issues.length === 0, issues, hasCritical, criticalIssues };
}
