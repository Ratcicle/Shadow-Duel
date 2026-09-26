export type PreviewPanelMode = "docked-right" | "docked-left" | "floating";
export type PreviewPanelState =
  | { mode: "docked-right" | "docked-left" }
  | { mode: "floating"; x: number; y: number };

interface Point { x: number; y: number }
interface Size { width: number; height: number }
type PreviewStorage = Pick<Storage, "getItem" | "setItem">;

export const PREVIEW_PANEL_STORAGE_KEY = "shadow_duel_preview_layout_v1";
const DRAG_THRESHOLD = 4;
const DOCK_THRESHOLD = 48;
const VIEWPORT_MARGIN = 8;

export function parsePreviewPanelState(raw: string | null): PreviewPanelState {
  const fallback: PreviewPanelState = { mode: "docked-right" };
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !("version" in value) || value.version !== 1 || !("mode" in value)) return fallback;
    switch (value.mode) {
      case "docked-left":
      case "docked-right":
        return { mode: value.mode };
      case "floating":
        if ("x" in value && typeof value.x === "number" && Number.isFinite(value.x)
          && "y" in value && typeof value.y === "number" && Number.isFinite(value.y)) {
          return { mode: "floating", x: value.x, y: value.y };
        }
        return fallback;
      default:
        return fallback;
    }
  } catch {
    return fallback;
  }
}

function browserStorage(): PreviewStorage | null {
  try { return localStorage; } catch { return null; }
}

export function createPreviewPanelPreference(storage: PreviewStorage | null = browserStorage()) {
  let state: PreviewPanelState = { mode: "docked-right" };
  try { state = parsePreviewPanelState(storage?.getItem(PREVIEW_PANEL_STORAGE_KEY) ?? null); } catch {
    // A blocked storage API must not prevent using the panel.
  }
  return {
    getState: (): PreviewPanelState => ({ ...state }),
    setState(next: PreviewPanelState): void {
      state = { ...next };
      try { storage?.setItem(PREVIEW_PANEL_STORAGE_KEY, JSON.stringify({ version: 1, ...state })); } catch {
        // Keep the live state when persistence is unavailable or full.
      }
    },
  };
}

export function clampPreviewPosition(point: Point, panel: Size, viewport: Size, margin = VIEWPORT_MARGIN): Point {
  return {
    x: Math.max(margin, Math.min(point.x, viewport.width - margin - panel.width)),
    y: Math.max(margin, Math.min(point.y, viewport.height - margin - panel.height)),
  };
}

export function getPreviewDockMode(left: number, width: number, viewportWidth: number): PreviewPanelMode {
  const right = viewportWidth - left - width;
  if (left <= DOCK_THRESHOLD && left < right) return "docked-left";
  if (right <= DOCK_THRESHOLD) return "docked-right";
  return "floating";
}

export function hasPreviewDragStarted(start: Point, current: Point): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= DRAG_THRESHOLD;
}

export function getPreviewDragPosition(start: Point, current: Point, origin: Point): Point {
  return { x: origin.x + current.x - start.x, y: origin.y + current.y - start.y };
}

interface DragSession {
  pointerId: number;
  start: Point;
  origin: Point;
  initialState: PreviewPanelState;
  moving: boolean;
}

interface PreviewPanelController {
  getState(): PreviewPanelState;
  cancelDrag(): void;
  dispose(): void;
}

const controllers = new WeakMap<HTMLElement, PreviewPanelController>();

/** One controller for the persistent page sidebar, independent of Game/Renderer instances. */
export function installPreviewPanelLayout(
  sidebar: HTMLElement | null,
  accessibleLabel: string,
): PreviewPanelController | null {
  if (!sidebar) return null;
  const installed = controllers.get(sidebar);
  if (installed) return installed;
  const panel = sidebar.querySelector<HTMLElement>(".card-preview-panel");
  const handle = sidebar.querySelector<HTMLElement>(".card-preview-drag-handle");
  const doc = sidebar.ownerDocument;
  const view = doc.defaultView;
  if (!panel || !handle || !view) return null;

  const preference = createPreviewPanelPreference();
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let state = preference.getState();
  let drag: DragSession | null = null;
  let disposed = false;

  function available(): boolean {
    if (disposed) return false;
    if (!sidebar!.isConnected || !panel!.isConnected || !handle!.isConnected) {
      dispose();
      return false;
    }
    return true;
  }

  function apply(next: PreviewPanelState): void {
    if (!available()) return;
    sidebar!.dataset.previewMode = next.mode;
    if (next.mode === "floating") {
      // Measure after switching layout: the fixed sidebar has no transparent outer padding.
      const size = panel!.getBoundingClientRect();
      const cssMargin = Number.parseFloat(view!.getComputedStyle(sidebar!).getPropertyValue("--preview-panel-margin"));
      const position = clampPreviewPosition(next, size,
        { width: view!.innerWidth, height: view!.innerHeight },
        Number.isFinite(cssMargin) ? cssMargin : VIEWPORT_MARGIN);
      state = { mode: "floating", ...position };
      sidebar!.style.setProperty("--preview-panel-x", `${position.x}px`);
      sidebar!.style.setProperty("--preview-panel-y", `${position.y}px`);
    } else {
      state = { ...next };
      sidebar!.style.removeProperty("--preview-panel-x");
      sidebar!.style.removeProperty("--preview-panel-y");
    }
  }

  function finish(cancelled: boolean): void {
    const session = drag;
    if (!session) return;
    drag = null;
    delete sidebar!.dataset.previewDragging;
    if (handle!.hasPointerCapture(session.pointerId)) {
      handle!.releasePointerCapture(session.pointerId);
    }
    if (!session.moving || !available()) return;
    if (cancelled) {
      apply(session.initialState);
      return;
    }
    const rect = panel!.getBoundingClientRect();
    const mode = getPreviewDockMode(rect.left, rect.width, view!.innerWidth);
    if (mode !== "floating") apply({ mode });
    preference.setState(state);
  }

  function onPointerDown(event: PointerEvent): void {
    if (!available() || drag || !event.isPrimary || event.button !== 0) return;
    const rect = panel!.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: { x: rect.left, y: rect.top },
      initialState: { ...state },
      moving: false,
    };
    handle!.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!available() || !drag || drag.pointerId !== event.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!drag.moving && !hasPreviewDragStarted(drag.start, point)) return;
    drag.moving = true;
    sidebar!.dataset.previewDragging = "true";
    apply({ mode: "floating", ...getPreviewDragPosition(drag.start, point, drag.origin) });
    event.preventDefault();
  }

  function onPointerUp(event: PointerEvent): void {
    if (drag?.pointerId !== event.pointerId) return;
    if (drag.moving) onPointerMove(event);
    finish(false);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (drag?.pointerId === event.pointerId) finish(true);
  }

  function cancelDrag(): void { finish(true); }

  function onResize(): void {
    if (!available()) return;
    cancelDrag();
    if (state.mode === "floating") {
      apply(state);
      preference.setState(state);
    }
  }

  function dispose(): void {
    if (disposed) return;
    // Clear capture before aborting its listeners; finish clears the session first.
    cancelDrag();
    disposed = true;
    listeners.abort();
    controllers.delete(sidebar!);
  }

  handle.removeAttribute("aria-hidden");
  handle.setAttribute("role", "group");
  handle.setAttribute("aria-label", accessibleLabel);
  handle.addEventListener("pointerdown", onPointerDown, options);
  handle.addEventListener("pointermove", onPointerMove, options);
  handle.addEventListener("pointerup", onPointerUp, options);
  handle.addEventListener("pointercancel", onPointerCancel, options);
  handle.addEventListener("lostpointercapture", onPointerCancel, options);
  view.addEventListener("resize", onResize, options);
  view.addEventListener("blur", cancelDrag, options);
  view.addEventListener("pagehide", cancelDrag, options);
  doc.addEventListener("visibilitychange", () => { if (doc.hidden) cancelDrag(); }, options);
  view.addEventListener("keydown", (event) => {
    if (drag && event.key === "Escape") {
      event.preventDefault();
      cancelDrag();
    }
  }, options);

  const controller: PreviewPanelController = { getState: () => ({ ...state }), cancelDrag, dispose };
  controllers.set(sidebar, controller);
  apply(state);
  return controller;
}
