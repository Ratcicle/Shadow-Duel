interface CardMoveRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DeckCardMoveSource {
  rect: CardMoveRect;
  className: string;
  backgroundImage: string;
}

function motionDisabled() {
  return typeof window === "undefined" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Intersect with the viewport and scroll containers, including a scrolled pool.
function visibleRect(element: HTMLElement | null): CardMoveRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right);
  let bottom = Math.min(window.innerHeight, rect.bottom);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    if (style.overflowX !== "visible") {
      left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right);
    }
    if (style.overflowY !== "visible") {
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
  }
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

export function captureDeckCardMove(source: HTMLElement | null): DeckCardMoveSource | null {
  if (motionDisabled() || !source || !visibleRect(source)) return null;
  const { x, y, width, height } = source.getBoundingClientRect();
  return { rect: { x, y, width, height }, className: source.className,
    backgroundImage: source.style.backgroundImage };
}

/** Presentation only: each edit owns its ghost; no game animation or state dependency. */
export function createDeckBuilderMotion() {
  const active = new Map<Animation, HTMLElement>();

  function move(source: DeckCardMoveSource | null, destination: HTMLElement | null, fallback: HTMLElement | null = null) {
    if (!source || motionDisabled() || !document.body) return;
    const target = visibleRect(destination) ? destination!.getBoundingClientRect() : null;
    const region = target ? null : visibleRect(fallback);
    if (!target && !region) return;

    const scale = target ? target.width / source.rect.width : 0.82;
    const x = target ? target.x : region!.x + (region!.width - source.rect.width * scale) / 2;
    const y = target ? target.y : region!.y + (region!.height - source.rect.height * scale) / 2;
    const ghost = document.createElement("div");
    ghost.className = `${source.className} deck-card-move-ghost`;
    ghost.setAttribute("aria-hidden", "true");
    Object.assign(ghost.style, {
      left: `${source.rect.x}px`, top: `${source.rect.y}px`,
      width: `${source.rect.width}px`, height: `${source.rect.height}px`,
      backgroundImage: source.backgroundImage,
    });
    if (typeof ghost.animate !== "function") return;
    document.body.appendChild(ghost);
    const animation = ghost.animate([
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: `translate(${x - source.rect.x}px, ${y - source.rect.y}px) scale(${scale})`, opacity: target ? 1 : 0 },
    ], { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    active.set(animation, ghost);
    const cleanup = () => { ghost.remove(); active.delete(animation); };
    void animation.finished.then(cleanup, cleanup);
  }

  function dispose() {
    for (const [animation, ghost] of active) {
      animation.cancel();
      ghost.remove();
    }
    active.clear();
  }

  return { move, dispose };
}
