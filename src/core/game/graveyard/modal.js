/**
 * modal.js
 *
 * Graveyard modal methods extracted from Game.js.
 * Handles graveyard viewing and effect activation UI.
 *
 * Methods: openGraveyardModal, closeGraveyardModal
 */

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
      return this.effectEngine.hasActivatableGraveyardEffect(card);
    };

    // Se não tem onSelect customizado, usar o padrão para ativar efeitos
    if (!options.onSelect) {
      options.onSelect = (card) => {
        if (!this.effectEngine.hasActivatableGraveyardEffect(card)) {
          return;
        }
        const activationContext = {
          fromHand: false,
          activationZone: "graveyard",
          sourceZone: "graveyard",
          committed: false,
        };
        const activationEffect = this.effectEngine?.getMonsterIgnitionEffect?.(
          card,
          "graveyard"
        );
        this.runActivationPipeline({
          card,
          owner: player,
          activationZone: "graveyard",
          activationContext,
          selectionKind: "graveyardEffect",
          selectionMessage: "Select target(s) for the graveyard effect.",
          guardKind: "graveyard_effect",
          phaseReq: ["main1", "main2"],
          oncePerTurn: {
            card,
            player,
            effect: activationEffect,
          },
          onSelectionStart: () => this.closeGraveyardModal(false),
          activate: (chosen, ctx) =>
            this.effectEngine.activateMonsterFromGraveyard(
              card,
              player,
              chosen,
              ctx
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
