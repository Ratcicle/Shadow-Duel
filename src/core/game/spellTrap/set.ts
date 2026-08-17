// ─────────────────────────────────────────────────────────────────────────────
// src/core/game/spellTrap/set.js
// Spell/Trap set methods for Game class — B.9 extraction
// ─────────────────────────────────────────────────────────────────────────────

import { FAST_EFFECT_ORIGINS } from "../../chain/timing.js";
import type { GameCard } from "../../contracts/cards.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { CardSetEventPayload } from "../../contracts/events.js";
import type { MaybePromise } from "../../contracts/actionRuntime.js";

interface SetActionGuardResult {
  ok: boolean;
  reason?: string;
}

interface SetTimingResult {
  ok?: boolean;
  success?: boolean;
  needsSelection?: boolean;
}

interface SetSpellTrapHost {
  player: GamePlayer;
  turnCounter: number;
  phase: string;
  ui: { log(message: string): void };
  chainSystem?: {
    runFastEffectTiming?(input: {
      origin: typeof FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN;
      actionPlayer: GamePlayer;
      context: {
        type: "action_without_chain";
        event: "card_set";
        card: GameCard;
        player: GamePlayer;
        triggerPlayer: GamePlayer;
        phase: string;
        currentPhase: string;
        addTriggerToChain: false;
      };
    }): MaybePromise<SetTimingResult | null>;
  } | null;
  guardActionStart(input: {
    actor: GamePlayer;
    kind: "set_spell_trap";
    phaseReq: readonly ["main1", "main2"];
  }): SetActionGuardResult;
  moveCard(
    card: GameCard,
    player: GamePlayer,
    zone: "spellTrap",
    options: { fromZone: "hand" },
  ): MaybePromise<unknown>;
  notify(eventName: "card_set", payload: CardSetEventPayload): void;
  updateBoard(): void;
}

/**
 * Sets a Spell or Trap card from hand to the spell/trap zone.
 * @param card - The card to set.
 * @param handIndex - Index of the card in the player's hand.
 * @param actor - The player performing the action.
 * @returns Result with ok status and timing metadata.
 */
export async function setSpellOrTrap(
  this: SetSpellTrapHost,
  card: GameCard | null | undefined,
  handIndex: number,
  actor: GamePlayer = this.player,
) {
  const guard = this.guardActionStart({
    actor,
    kind: "set_spell_trap",
    phaseReq: ["main1", "main2"],
  });
  if (!guard.ok) return guard;
  if (!card) return { ok: false, reason: "no_card" };
  if (card.cardKind !== "spell" && card.cardKind !== "trap") {
    return { ok: false, reason: "not_spell_trap" };
  }

  if (card.cardKind === "spell" && card.subtype === "field") {
    this.ui.log("Field Spells cannot be Set.");
    return { ok: false, reason: "cannot_set_field_spell" };
  }

  const zone = actor.spellTrap;
  if (zone.length >= 5) {
    this.ui.log("Spell/Trap zone is full (max 5 cards).");
    return { ok: false, reason: "zone_full" };
  }

  card.isFacedown = true;
  card.turnSetOn = this.turnCounter;
  card.setTurn = this.turnCounter;

  if (typeof this.moveCard === "function") {
    await this.moveCard(card, actor, "spellTrap", { fromZone: "hand" });
  } else {
    // Fallback (should not happen)
    if (handIndex >= 0 && handIndex < actor.hand.length) {
      actor.hand.splice(handIndex, 1);
    }
    actor.spellTrap.push(card);
  }

  // Emitir evento informativo para captura de replay (não bloqueia)
  this.notify("card_set", {
    card,
    player: actor,
    zone: "spellTrap",
  });

  this.updateBoard();
  const timing = await this.chainSystem?.runFastEffectTiming?.({
    origin: FAST_EFFECT_ORIGINS.ACTION_WITHOUT_CHAIN,
    actionPlayer: actor,
    context: {
      type: "action_without_chain",
      event: "card_set",
      card,
      player: actor,
      triggerPlayer: actor,
      phase: this.phase,
      currentPhase: this.phase,
      addTriggerToChain: false,
    },
  });
  return {
    ok: timing?.ok !== false,
    success: timing?.success !== false,
    needsSelection: timing?.needsSelection === true,
    card,
    timing: timing || null,
  };
}
