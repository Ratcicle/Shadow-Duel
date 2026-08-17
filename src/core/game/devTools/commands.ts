/**
 * DevTools Commands for Game
 * Handles: devDraw, devGiveCard, devForcePhase,
 * devGetSelectionCleanupState, devForceTargetCleanup, devAutoConfirmTargetSelection
 */

import type {
  FullGameHost,
  GameCard,
  GameDevToolsHost,
  GamePlayer,
} from "../../contracts/gameRuntime.js";
import type { GamePhase } from "../../contracts/game.js";
import type { PlayerId } from "../../contracts/primitives.js";
import type {
  ActiveSelectionSession,
  SelectionSessionState,
} from "../../contracts/selection.js";
import type { DrawCardsResult } from "../deck/draw.js";

type DevCardZone =
  | "hand"
  | "graveyard"
  | "spelltrap"
  | "field-attack"
  | "field-defense"
  | "fieldspell";

interface DevGiveCardOptions {
  playerId?: PlayerId;
  zone?: DevCardZone | string;
  cardName?: string;
  name?: string;
  duelCardId?: number;
  position?: "attack" | "defense";
  isFacedown?: boolean;
  facedown?: boolean;
  turnSetOn?: number;
  counters?: { readonly [counterType: string]: number };
}

interface DevSelectionUiPort {
  getSelectionCleanupState?(): {
    controlsVisible?: boolean;
    highlightCount?: number;
  };
  hideFieldTargetingControls?(): void;
}

type DevCommandHost = GameDevToolsHost &
  Pick<
    FullGameHost,
    "phase" | "turn" | "targetSelection" | "selectionState" | "ui"
  > & {
    ui?: DevSelectionUiPort;
    resolvePlayerById(id: PlayerId): GamePlayer | null;
    createCardForOwner(
      identifier: string | undefined,
      owner: GamePlayer,
      overrides?: DevGiveCardOptions,
    ): GameCard | null;
    drawCards(player: GamePlayer, count?: number): DrawCardsResult;
    updateBoard(): unknown;
    forceClearTargetSelection(reason: string): void;
    clearTargetHighlights(): void;
    setSelectionState(state: SelectionSessionState): void;
    finishTargetSelection(): Promise<unknown>;
    devLog(code: string, detail?: unknown): void;
    targetSelection: ActiveSelectionSession | null;
  };

const VALID_PHASES = new Set<GamePhase>([
  "draw",
  "standby",
  "main1",
  "battle",
  "main2",
  "end",
]);

function isGamePhase(value: string): value is GamePhase {
  return [...VALID_PHASES].some((phase) => phase === value);
}

/**
 * @this {import('../../Game.js').default}
 */
export function devDraw(
  this: DevCommandHost,
  playerId: PlayerId = "player",
  count = 1,
) {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  const player = this.resolvePlayerById(playerId);
  if (!player) {
    return { success: false, reason: "Invalid player id." };
  }

  const draws = Math.max(1, Number(count) || 1);
  const drawResult = this.drawCards(player, draws);
  const drawn = (drawResult.drawn || []).map((card) => card?.name);

  if (!drawResult.ok) {
    return { success: false, reason: "Deck is empty.", drawn };
  }

  this.updateBoard();
  this.devLog("DEV_DRAW", {
    summary: `${player.id} drew ${drawn.length}`,
    player: player.id,
    cards: drawn,
  });
  return { success: true, drawn };
}

/**
 * @this {import('../../Game.js').default}
 */
export function devGiveCard(
  this: DevCommandHost,
  options: DevGiveCardOptions = {},
) {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  const player = this.resolvePlayerById(options.playerId || "player");
  if (!player) {
    return { success: false, reason: "Invalid player id." };
  }

  const zone = (options.zone || "hand").toLowerCase();
  const card = this.createCardForOwner(
    options.cardName || options.name,
    player,
    options
  );
  if (!card) {
    return { success: false, reason: "Card not found." };
  }

  const sendOldFieldSpell = (existing: GameCard | null) => {
    if (existing) {
      player.graveyard.push(existing);
    }
  };

  if (zone === "hand") {
    player.hand.push(card);
  } else if (zone === "graveyard") {
    player.graveyard.push(card);
  } else if (zone === "spelltrap") {
    if (player.spellTrap.length >= 5) {
      return { success: false, reason: "Spell/Trap zone is full." };
    }
    if (card.cardKind === "monster") {
      return {
        success: false,
        reason: "Only Spell/Trap cards can go to that zone.",
      };
    }
    player.spellTrap.push(card);
  } else if (zone === "field-attack" || zone === "field-defense") {
    if (player.field.length >= 5) {
      return { success: false, reason: "Field is full (max 5 monsters)." };
    }
    if (card.cardKind !== "monster") {
      return { success: false, reason: "Only monsters can enter the field." };
    }
    card.position = zone === "field-defense" ? "defense" : "attack";
    card.hasAttacked = false;
    card.attacksUsedThisTurn = 0;
    player.field.push(card);
  } else if (zone === "fieldspell") {
    if (card.cardKind !== "spell" || card.subtype !== "field") {
      return { success: false, reason: "Card is not a Field Spell." };
    }
    sendOldFieldSpell(player.fieldSpell);
    player.fieldSpell = card;
  } else {
    return { success: false, reason: "Unsupported zone." };
  }

  this.updateBoard();
  this.devLog("DEV_GIVE_CARD", {
    summary: `${card.name} -> ${zone} (${player.id})`,
    player: player.id,
    card: card.name,
    zone,
  });
  return { success: true, card };
}

/**
 * @this {import('../../Game.js').default}
 */
export function devForcePhase(
  this: DevCommandHost,
  targetPhase: string,
  options: { turn?: PlayerId } = {},
) {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }

  if (!isGamePhase(targetPhase)) {
    return { success: false, reason: "Invalid phase." };
  }

  this.phase = targetPhase;
  if (options.turn === "player" || options.turn === "bot") {
    this.turn = options.turn;
  }
  this.updateBoard();
  this.devLog("DEV_FORCE_PHASE", {
    summary: `Phase forced to ${this.phase}`,
    phase: this.phase,
    turn: this.turn,
  });
  return { success: true };
}

/**
 * @this {import('../../Game.js').default}
 */
export function devGetSelectionCleanupState(this: DevCommandHost) {
  const uiState =
    this.ui && typeof this.ui.getSelectionCleanupState === "function"
      ? this.ui.getSelectionCleanupState()
      : { controlsVisible: false, highlightCount: 0 };
  return {
    selectionActive: !!this.targetSelection,
    selectionState: this.selectionState,
    controlsVisible: !!uiState.controlsVisible,
    highlightCount: uiState.highlightCount || 0,
  };
}

/**
 * @this {import('../../Game.js').default}
 */
export function devForceTargetCleanup(this: DevCommandHost) {
  if (this.targetSelection) {
    this.forceClearTargetSelection("dev_force_cleanup");
    return;
  }
  this.clearTargetHighlights();
  if (this.ui && typeof this.ui.hideFieldTargetingControls === "function") {
    this.ui.hideFieldTargetingControls();
  }
  this.setSelectionState("idle");
}

/**
 * @this {import('../../Game.js').default}
 */
export async function devAutoConfirmTargetSelection(this: DevCommandHost) {
  if (!this.devModeEnabled) {
    return { success: false, reason: "Dev Mode is disabled." };
  }
  const selection = this.targetSelection;
  if (!selection || !Array.isArray(selection.requirements)) {
    return { success: false, reason: "No active target selection." };
  }

  const selections: ActiveSelectionSession["selections"] = {};
  let canSatisfy = true;

  for (const requirement of selection.requirements) {
    const min = Number(requirement.min ?? 0);
    const candidates = Array.isArray(requirement.candidates)
      ? requirement.candidates
      : [];
    if (candidates.length < min) {
      canSatisfy = false;
    }
    selections[requirement.id] = candidates
      .slice(0, min)
      .map((cand) => cand.key);
  }

  if (!canSatisfy) {
    return {
      success: false,
      reason: "Not enough candidates to auto-confirm.",
    };
  }

  selection.selections = selections;
  selection.currentRequirement = selection.requirements.length;
  this.setSelectionState("confirming");
  await this.finishTargetSelection();
  return { success: true };
}
