/**
 * modal.js
 *
 * Graveyard modal methods extracted from Game.js.
 * Handles graveyard viewing and effect activation UI.
 *
 * Methods: openGraveyardModal, closeGraveyardModal
 */

import type {
  GameCard,
  GamePlayer,
} from "../../contracts/gameRuntime.js";
import type { EffectDefinition } from "../../contracts/effects.js";

interface ActivationPreview {
  ok: boolean;
  reason?: string | null;
}

interface MonsterActivationEntry {
  effect: EffectDefinition;
  preview: ActivationPreview;
}

interface GraveyardEffectEnginePort {
  hasActivatableGraveyardEffect(card: GameCard, player: GamePlayer): boolean;
  getFirstActivatableMonsterIgnitionEffect?(
    card: GameCard,
    player: GamePlayer,
    zone: "graveyard",
  ): MonsterActivationEntry | null;
  canActivateSpellTrapEffectPreview?(
    card: GameCard,
    player: GamePlayer,
    zone: "graveyard",
  ): ActivationPreview;
  canActivateMonsterEffectPreview?(
    card: GameCard,
    player: GamePlayer,
    zone: "graveyard",
  ): ActivationPreview;
}

interface GraveyardModalOptions {
  selectable?: boolean;
  onCancel?: (() => void) | null;
  showActivatable?: boolean;
  isActivatable?: (card: GameCard) => boolean;
  onSelect?: (card: GameCard) => void;
}

interface GraveyardUiPort {
  log(message: string): void;
  renderGraveyardModal(
    cards: GameCard[],
    options: GraveyardModalOptions,
  ): void;
  toggleModal(open: boolean): void;
}

interface GraveyardHost {
  tryActivateSpellTrapEffect(card: GameCard, selections: null, options: { owner: GamePlayer; activationZone: "graveyard" }): Promise<unknown>;
  tryActivateMonsterEffect(card: GameCard, selections: null, activationZone: "graveyard", owner: GamePlayer,
    options: { effectId: string | null }): Promise<unknown>;
  turn: "player" | "bot";
  graveyardSelection: { onCancel: (() => void) | null } | null;
  effectEngine: GraveyardEffectEnginePort;
  ui: GraveyardUiPort;
  closeGraveyardModal(triggerCancel?: boolean): void;
  updateBoard(): unknown;
}

/**
 * Opens the graveyard modal for a player.
 * Optionally enables effect activation mode.
 * @param player - The player whose graveyard to show
 * @param options - Options { selectable, onCancel, showActivatable, isActivatable, onSelect }
 */
export function openGraveyardModal(
  this: GraveyardHost,
  player: GamePlayer,
  options: GraveyardModalOptions = {},
) {
  if (options.selectable) {
    this.graveyardSelection = { onCancel: options.onCancel || null };
  } else {
    this.graveyardSelection = null;
  }

  // Se não está em modo de seleção, mostrar indicador de efeitos ativáveis
  if (!options.selectable && player.id === "player" && this.turn === "player") {
    options.showActivatable = true;
    options.isActivatable = (card: GameCard) => {
      return this.effectEngine.hasActivatableGraveyardEffect(card, player);
    };

    // Se não tem onSelect customizado, usar o padrão para ativar efeitos
    if (!options.onSelect) {
      options.onSelect = (card: GameCard) => {
        const isSpellTrap =
          card?.cardKind === "spell" || card?.cardKind === "trap";
        const monsterEffectEntry = !isSpellTrap
          ? this.effectEngine?.getFirstActivatableMonsterIgnitionEffect?.(
              card,
              player,
              "graveyard",
            )
          : null;
        const preview = isSpellTrap
          ? this.effectEngine.canActivateSpellTrapEffectPreview?.(
              card,
              player,
              "graveyard",
            )
          : monsterEffectEntry?.preview ||
            this.effectEngine.canActivateMonsterEffectPreview?.(
                card,
                player,
                "graveyard",
              );
        if (!preview?.ok) {
          if (preview?.reason) {
            this.ui.log(preview.reason);
          }
          return;
        }
        if (isSpellTrap) {
          this.closeGraveyardModal(false);
          void this.tryActivateSpellTrapEffect(card, null, { owner: player, activationZone: "graveyard" });
          return;
        }
        // The canonical entrypoint records the command that replays drive.
        this.closeGraveyardModal(false);
        void this.tryActivateMonsterEffect(card, null, "graveyard", player, {
          effectId: monsterEffectEntry?.effect?.id || null,
        });
      };
      options.selectable = true;
    }
  }

  this.ui.renderGraveyardModal(player.graveyard, options);
  this.ui.toggleModal(true);
}

/**
 * Closes the graveyard modal.
 * @param {boolean} triggerCancel - Whether to trigger onCancel callback (default: true)
 */
export function closeGraveyardModal(
  this: GraveyardHost,
  triggerCancel = true,
) {
  this.ui.toggleModal(false);
  if (triggerCancel && this.graveyardSelection?.onCancel) {
    this.graveyardSelection.onCancel();
  }
  this.graveyardSelection = null;
}
