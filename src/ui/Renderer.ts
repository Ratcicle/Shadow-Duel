import type { GameUI } from "../core/contracts/ui.js";
import {
  RENDERER_METHODS,
  type RendererMethods,
} from "./renderer/attachments.js";
import type { EquipLink, LpDisplayState } from "./renderer/types.js";
import type { PlayerId } from "../core/contracts/primitives.js";

/**
 * Renderer - Main UI rendering class for Shadow Duel
 *
 * This is the facade that maintains backward compatibility.
 * The class owns the constructor; methods are attached from modules.
 */

// Import all module functions
import PixiVfxLayer from "./pixi/PixiVfxLayer.js";

class Renderer implements GameUI {
  declare destroyed: boolean;
  declare leftMouseHeldForChainSkip: boolean;
  declare chainSkipInputCleanup: (() => void) | null;
  declare activeTrapModalCancel: (() => void) | null;
  declare activeEquipLinks: EquipLink[];
  declare equipLinkResizeHandler: (() => void) | null;
  declare lpDisplayState: Partial<Record<PlayerId, LpDisplayState>>;
  declare pixiVfx: PixiVfxLayer | null;
  declare activeAttackAnimationKeys?: Set<string>;
  declare elements: {
    playerHand: HTMLElement | null;
    playerField: HTMLElement | null;
    playerSpellTrap: HTMLElement | null;
    playerDeck: HTMLElement | null;
    playerGraveyard: HTMLElement | null;
    playerLP: HTMLElement | null;
    botHand: HTMLElement | null;
    botField: HTMLElement | null;
    botSpellTrap: HTMLElement | null;
    botDeck: HTMLElement | null;
    botGraveyard: HTMLElement | null;
    botLP: HTMLElement | null;
    playerFieldSpell: HTMLElement | null;
    botFieldSpell: HTMLElement | null;
    turnIndicator: HTMLElement | null;
    priorityIndicator: HTMLElement | null;
    phaseTrack: HTMLElement | null;
    actionLog: HTMLElement | null;
  };

  constructor() {
    this.destroyed = false;
    this.leftMouseHeldForChainSkip = false;
    this.chainSkipInputCleanup = null;
    this.activeTrapModalCancel = null;
    this.activeEquipLinks = [];
    this.equipLinkResizeHandler = null;
    this.lpDisplayState = {
      player: {
        displayed: 8000,
        animating: false,
        queue: [],
        floatingPromises: new Set(),
        presentationPromise: null,
      },
      bot: {
        displayed: 8000,
        animating: false,
        queue: [],
        floatingPromises: new Set(),
        presentationPromise: null,
      },
    };
    this.elements = {
      playerHand: document.getElementById("player-hand"),
      playerField: document.getElementById("player-field"),
      playerSpellTrap: document.getElementById("player-spelltrap"),
      playerDeck: document.getElementById("player-deck"),
      playerGraveyard: document.getElementById("player-graveyard"),
      playerLP: document.getElementById("player-lp"),
      botHand: document.getElementById("bot-hand"),
      botField: document.getElementById("bot-field"),
      botSpellTrap: document.getElementById("bot-spelltrap"),
      botDeck: document.getElementById("bot-deck"),
      botGraveyard: document.getElementById("bot-graveyard"),
      botLP: document.getElementById("bot-lp"),
      playerFieldSpell: document.getElementById("player-fieldspell"),
      botFieldSpell: document.getElementById("bot-fieldspell"),
      turnIndicator: document.getElementById("turn-indicator"),
      priorityIndicator: document.getElementById("priority-indicator"),
      phaseTrack: document.getElementById("phase-track"),
      actionLog: document.getElementById("action-log-list"),
    };
    this.bindChainSkipInputTracking();
    this.pixiVfx = new PixiVfxLayer();
    const pixiVfx = this.pixiVfx;
    pixiVfx
      .init(document.getElementById("game-container"))
      .then(() => {
        if (this.destroyed || this.pixiVfx !== pixiVfx) {
          pixiVfx.destroy();
        }
      })
      .catch((error) => {
        console.warn("[Renderer] Pixi VFX layer unavailable.", error);
        if (this.pixiVfx === pixiVfx) {
          this.pixiVfx = null;
        }
        pixiVfx.destroy();
      });
  }

  bindChainSkipInputTracking() {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const setHeld = (held: boolean) => {
      this.leftMouseHeldForChainSkip = held === true;
    };

    const isMouseInput = (event: MouseEvent & { pointerType?: string }) =>
      !event?.pointerType || event.pointerType === "mouse";
    const isLeftButton = (event: MouseEvent) => event?.button === 0;

    const handleDown = (event: MouseEvent) => {
      if (isMouseInput(event) && isLeftButton(event)) {
        setHeld(true);
      }
    };

    const handleUp = (event: MouseEvent) => {
      if (isMouseInput(event) && isLeftButton(event)) {
        setHeld(false);
      }
    };

    const clearHeld = () => setHeld(false);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearHeld();
      }
    };

    const capture = true;
    document.addEventListener("pointerdown", handleDown, capture);
    document.addEventListener("mousedown", handleDown, capture);
    document.addEventListener("pointerup", handleUp, capture);
    document.addEventListener("mouseup", handleUp, capture);
    document.addEventListener("pointercancel", clearHeld, capture);
    window.addEventListener("blur", clearHeld, capture);
    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
      capture,
    );

    this.chainSkipInputCleanup = () => {
      document.removeEventListener("pointerdown", handleDown, capture);
      document.removeEventListener("mousedown", handleDown, capture);
      document.removeEventListener("pointerup", handleUp, capture);
      document.removeEventListener("mouseup", handleUp, capture);
      document.removeEventListener("pointercancel", clearHeld, capture);
      window.removeEventListener("blur", clearHeld, capture);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
        capture,
      );
      clearHeld();
    };
  }

  isLeftMouseHeldForChainSkip() {
    return this.destroyed !== true && this.leftMouseHeldForChainSkip === true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.chainSkipInputCleanup?.();
    this.chainSkipInputCleanup = null;
    this.activeTrapModalCancel?.();
    this.activeTrapModalCancel = null;
    this.clearFloatingCounterTooltip?.();
    this.destroyEquipLinkIndicators?.();
    this.pixiVfx?.destroy?.();
    this.pixiVfx = null;
  }
}

/** Declaration merging exposes attached methods without emitting class fields. */
interface Renderer extends RendererMethods {}
Object.assign(Renderer.prototype, RENDERER_METHODS);
export default Renderer;
