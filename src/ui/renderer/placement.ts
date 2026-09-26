import type Renderer from "../Renderer.js";
import type {
  FieldPlacementRequest,
  FieldPlacementResult,
} from "../../core/contracts/placement.js";
import { getUIText } from "../../core/i18n.js";

export interface FieldPlacementSession {
  request: FieldPlacementRequest;
  row: HTMLElement;
  refresh: () => void;
  abort: () => void;
}

/** A slot is a decision candidate only while this dedicated session is active. */
export function chooseFieldPlacement(
  this: Renderer,
  request: FieldPlacementRequest,
): Promise<FieldPlacementResult> {
  if (this.activeFieldPlacement) {
    return Promise.reject(new Error("A field placement choice is already pending"));
  }
  const board = document.getElementById("game-container");
  const phaseTrack = this.elements.phaseTrack;
  const row = request.destinationPlayerId === "player"
    ? request.row === "field" ? this.elements.playerField : this.elements.playerSpellTrap
    : request.row === "field" ? this.elements.botField : this.elements.botSpellTrap;
  if (this.destroyed || !board || !phaseTrack || !row || request.candidates.length === 0) {
    return Promise.reject(new Error("Field placement UI is unavailable"));
  }
  // Freeze the values relevant to this decision; a changed preference affects
  // only the next request. The engine will revalidate before applying the result.
  const candidates = request.candidates.map((candidate) => ({ ...candidate }));
  const snapshot = { ...request, candidates };
  const previousFocus = document.activeElement;
  const prompt = document.createElement("li");
  prompt.className = "field-placement-prompt";
  prompt.setAttribute("role", "status");
  const instruction = document.createElement("span");
  instruction.textContent = getUIText("ui.placement.chooseSpace");
  prompt.appendChild(instruction);
  let cancelButton: HTMLButtonElement | null = null;
  if (snapshot.allowCancel) {
    cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = getUIText("ui.common.cancel");
    prompt.appendChild(cancelButton);
  }

  return new Promise<FieldPlacementResult>((resolve, reject) => {
    let finished = false;
    let focusedSlot: string | undefined;
    const slots = () => Array.from(row.querySelectorAll<HTMLElement>(".field-card-slot"));
    const available = () => slots().filter((slot) => slot.classList.contains("placement-available"));
    const clearSlot = (slot: HTMLElement) => {
      slot.classList.remove("placement-available");
      slot.removeAttribute("role");
      slot.removeAttribute("tabindex");
      slot.removeAttribute("aria-label");
    };
    const cleanup = () => {
      if (finished) return;
      finished = true;
      board.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("keydown", onKey, { capture: true });
      row.removeEventListener("focusin", onFocus);
      for (const slot of slots()) clearSlot(slot);
      phaseTrack.classList.remove("field-placement-active");
      prompt.remove();
      if (this.activeFieldPlacement === session) this.activeFieldPlacement = null;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
    const complete = (result: FieldPlacementResult) => {
      if (finished) return;
      cleanup();
      resolve(result);
    };
    const select = (element: Element | null) => {
      const slot = element?.closest<HTMLElement>(".field-card-slot");
      if (!slot || !row.contains(slot) || !slot.classList.contains("placement-available") || slot.querySelector(".card")) return;
      const candidate = candidates.find((entry) => String(entry.slot) === slot.dataset.fieldSlot);
      if (candidate) complete({ outcome: "chosen", slot: candidate.slot });
    };
    const onClick = (event: MouseEvent) => {
      // Keep hover and preview active; consume board actions while choosing.
      event.preventDefault();
      event.stopImmediatePropagation();
      const target = event.target instanceof Element ? event.target : null;
      if (cancelButton && target && cancelButton.contains(target)) {
        complete({ outcome: "cancelled" });
      } else {
        select(target);
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target.classList.contains("placement-available")) {
        focusedSlot = event.target.dataset.fieldSlot;
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (snapshot.allowCancel) complete({ outcome: "cancelled" });
        return;
      }
      if (event.key === "Tab" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const focusable: HTMLElement[] = [...available(), ...(cancelButton ? [cancelButton] : [])];
        if (focusable.length === 0) return;
        const index = focusable.findIndex((entry) => entry === document.activeElement);
        const backward = event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey);
        focusable[(index + (backward ? -1 : 1) + focusable.length) % focusable.length]?.focus({ preventScroll: true });
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (cancelButton && document.activeElement === cancelButton) complete({ outcome: "cancelled" });
        else select(document.activeElement);
      }
    };
    const refresh = () => {
      const hadSlotFocus = document.activeElement === document.body || slots().some((slot) => slot === document.activeElement);
      for (const slot of slots()) {
        clearSlot(slot);
        if (slot.querySelector(".card") || !candidates.some((entry) => String(entry.slot) === slot.dataset.fieldSlot)) continue;
        slot.classList.add("placement-available");
        slot.setAttribute("role", "button");
        slot.tabIndex = 0;
        slot.setAttribute("aria-label", getUIText("ui.placement.spaceLabel", { number: Number(slot.dataset.fieldSlot) + 1 }));
      }
      if (hadSlotFocus && focusedSlot !== undefined) {
        available().find((slot) => slot.dataset.fieldSlot === focusedSlot)?.focus({ preventScroll: true });
      }
    };
    const session: FieldPlacementSession = {
      request: snapshot,
      row,
      refresh,
      abort: () => {
        if (finished) return;
        cleanup();
        reject(new DOMException("Field placement session aborted", "AbortError"));
      },
    };
    this.activeFieldPlacement = session;
    phaseTrack.appendChild(prompt);
    phaseTrack.classList.add("field-placement-active");
    board.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    row.addEventListener("focusin", onFocus);
    refresh();
    available()[0]?.focus({ preventScroll: true });
  });
}

export function refreshFieldPlacement(this: Renderer): void {
  this.activeFieldPlacement?.refresh();
}

/** Reset/dispose is an abort, never a human cancellation after paid costs. */
export function cancelFieldPlacement(this: Renderer): void {
  this.activeFieldPlacement?.abort();
}
