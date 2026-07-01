/**
 * modal.js
 *
 * Graveyard modal methods extracted from Game.js.
 * Handles graveyard viewing and effect activation UI.
 *
 * Methods: openGraveyardModal, closeGraveyardModal
 */

import { getUIText } from "../../i18n.js";

/**
 * Opens the graveyard modal for a player.
 * Optionally enables effect activation mode.
 * @param {Object} player - The player whose graveyard to show
 * @param {Object} options - Options { selectable, onCancel, showActivatable, isActivatable, onSelect }
 */
export function openGraveyardModal(player, options = {}) {
  if (options.selectable) {
    this.graveyardSelection = { onCancel: options.onCancel || null };
  } else {
    this.graveyardSelection = null;
  }

  // Se não está em modo de seleção, mostrar indicador de efeitos ativáveis
  if (!options.selectable && player.id === "player" && this.turn === "player") {
    options.showActivatable = true;
    options.isActivatable = (card) => {
      return this.effectEngine.hasActivatableGraveyardEffect(card, player);
    };

    // Se não tem onSelect customizado, usar o padrão para ativar efeitos
    if (!options.onSelect) {
      options.onSelect = (card) => {
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
        const activationContext = {
          fromHand: false,
          activationZone: "graveyard",
          sourceZone: "graveyard",
          effectId: monsterEffectEntry?.effect?.id || null,
          committed: false,
        };
        const activationEffect = isSpellTrap
          ? this.effectEngine?.getSpellTrapActivationEffect?.(card, {
              fromHand: false,
              activationZone: "graveyard",
            })
          : this.effectEngine?.getMonsterIgnitionEffect?.(card, "graveyard", {
              effectId: activationContext.effectId,
            });
        this.runActivationPipeline({
          card,
          owner: player,
          activationZone: "graveyard",
          activationContext,
          selectionKind: "graveyardEffect",
          selectionMessage: isSpellTrap
            ? getUIText("ui.spell.spellSelection")
            : getUIText("ui.graveyard.selection"),
          guardKind: isSpellTrap
            ? "graveyard_spell_effect"
            : "graveyard_effect",
          phaseReq: ["main1", "main2"],
          oncePerTurn: {
            card,
            player,
            effect: activationEffect,
          },
          onSelectionStart: () => this.closeGraveyardModal(false),
          activate: (chosen, ctx) =>
            isSpellTrap
              ? this.effectEngine.activateSpellTrapEffect(
                  card,
                  player,
                  chosen,
                  "graveyard",
                  ctx,
                )
              : this.effectEngine.activateMonsterFromGraveyard(
                  card,
                  player,
                  chosen,
                  ctx,
                ),
          finalize: () => {
            this.closeGraveyardModal(false);
            this.ui.log(`${card.name} activates from the Graveyard.`);
            this.updateBoard();
          },
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
export function closeGraveyardModal(triggerCancel = true) {
  this.ui.toggleModal(false);
  if (triggerCancel && this.graveyardSelection?.onCancel) {
    this.graveyardSelection.onCancel();
  }
  this.graveyardSelection = null;
}
