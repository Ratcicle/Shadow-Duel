import {
  PREVIEW_VIEWPORT_MARGIN, clampPreviewPosition, clampPreviewSize, getPreviewSizeLimits,
  getPreviewDetachPosition, resizePreviewRect, resizeDockedWidth,
  type PreviewPoint, type PreviewRect, type PreviewResizeEdge,
} from "./previewPanelGeometry.js";
export { clampPreviewPosition } from "./previewPanelGeometry.js";

export type PreviewPanelMode = "docked-right" | "docked-left" | "floating";
export interface PreviewPanelState {
  mode: PreviewPanelMode;
  x?: number;
  y?: number;
  floatingWidth?: number;
  floatingHeight?: number;
  dockedWidth?: number;
}
type PreviewStorage = Pick<Storage, "getItem" | "setItem">;

export const PREVIEW_PANEL_STORAGE_KEY = "shadow_duel_preview_layout_v1";
const DRAG_THRESHOLD = 4;
const DOCK_THRESHOLD = 48;

export function parsePreviewPanelState(raw: string | null): PreviewPanelState {
  const fallback: PreviewPanelState = { mode: "docked-right" };
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !("version" in value) || (value.version !== 1 && value.version !== 2) || !("mode" in value)) return fallback;
    if (value.mode !== "floating" && value.mode !== "docked-left" && value.mode !== "docked-right") return fallback;
    const state: PreviewPanelState = { mode: value.mode };
    const fields: Record<string, unknown> = { ...value };
    for (const key of ["x", "y"] as const) {
      const field = fields[key];
      if (typeof field === "number" && Number.isFinite(field)) state[key] = field;
      else if (state.mode === "floating") state[key] = PREVIEW_VIEWPORT_MARGIN;
    }
    for (const key of ["floatingWidth", "floatingHeight", "dockedWidth"] as const) {
      const field = fields[key];
      if (typeof field === "number" && Number.isFinite(field) && field > 0) state[key] = field;
    }
    return state;
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
      try { storage?.setItem(PREVIEW_PANEL_STORAGE_KEY, JSON.stringify({ version: 2, ...state })); } catch {
        // Keep the live state when persistence is unavailable or full.
      }
    },
  };
}

export function getPreviewDockMode(left: number, width: number, viewportWidth: number): PreviewPanelMode {
  const right = viewportWidth - left - width;
  if (left <= DOCK_THRESHOLD && left < right) return "docked-left";
  if (right <= DOCK_THRESHOLD) return "docked-right";
  return "floating";
}

export function hasPreviewDragStarted(start: PreviewPoint, current: PreviewPoint): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= DRAG_THRESHOLD;
}

export function getPreviewDragPosition(start: PreviewPoint, current: PreviewPoint, origin: PreviewPoint): PreviewPoint {
  return { x: origin.x + current.x - start.x, y: origin.y + current.y - start.y };
}

interface PointerSession {
  pointerId: number;
  target: HTMLElement;
  start: PreviewPoint;
  origin: PreviewRect;
  initialState: PreviewPanelState;
  moving: boolean;
}
type PanelInteraction = PointerSession & (
  | { kind: "drag"; dragOrigin?: PreviewPoint }
  | { kind: "resize"; edge: PreviewResizeEdge }
);

interface PreviewPanelController {
  getState(): PreviewPanelState;
  cancelInteraction(): void;
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
  let interaction: PanelInteraction | null = null;
  let disposed = false;
  const laboratoryControls = sidebar.querySelector<HTMLElement>("#laboratory-duel-controls");

  function environment() {
    // Resolve the existing responsive CSS default without duplicating its breakpoints in TS.
    // The temporary removal is restored synchronously, before the browser can paint.
    const customWidth = sidebar!.style.getPropertyValue("--preview-panel-width");
    sidebar!.style.removeProperty("--preview-panel-width");
    const defaults = { width: panel!.getBoundingClientRect().width, height: view!.innerHeight - 2 * PREVIEW_VIEWPORT_MARGIN };
    if (customWidth) sidebar!.style.setProperty("--preview-panel-width", customWidth);
    const viewport = { width: view!.innerWidth, height: view!.innerHeight };
    const controlsHeight = laboratoryControls?.getBoundingClientRect().height ?? 0;
    const body = sidebar!.querySelector<HTMLElement>(".card-preview-body");
    const gap = body ? Number.parseFloat(view!.getComputedStyle(body).rowGap) || 0 : 0;
    const limits = getPreviewSizeLimits(viewport, defaults, controlsHeight > 0 ? controlsHeight + gap : 0);
    return { defaults, viewport, limits };
  }

  let geometry = environment();

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
    const { defaults, viewport, limits } = geometry;
    state = { ...next };
    const floatingSize = clampPreviewSize({ width: next.floatingWidth ?? defaults.width, height: next.floatingHeight ?? defaults.height }, limits);
    const dockedSize = clampPreviewSize({ width: next.dockedWidth ?? defaults.width, height: defaults.height }, limits);
    if (state.floatingWidth !== undefined) state.floatingWidth = floatingSize.width;
    if (state.floatingHeight !== undefined) state.floatingHeight = floatingSize.height;
    if (state.dockedWidth !== undefined) state.dockedWidth = dockedSize.width;
    sidebar!.dataset.previewMode = state.mode;
    sidebar!.style.setProperty("--preview-panel-width", `${state.mode === "floating" ? floatingSize.width : dockedSize.width}px`);
    if (next.mode === "floating") {
      const position = clampPreviewPosition({ x: next.x ?? PREVIEW_VIEWPORT_MARGIN, y: next.y ?? PREVIEW_VIEWPORT_MARGIN }, floatingSize, viewport);
      state = { ...state, ...position };
      sidebar!.style.setProperty("--preview-panel-height", `${floatingSize.height}px`);
      sidebar!.style.setProperty("--preview-panel-x", `${position.x}px`);
      sidebar!.style.setProperty("--preview-panel-y", `${position.y}px`);
    } else {
      sidebar!.style.removeProperty("--preview-panel-height");
      sidebar!.style.removeProperty("--preview-panel-x");
      sidebar!.style.removeProperty("--preview-panel-y");
    }
  }

  function finish(cancelled: boolean): void {
    const session = interaction;
    if (!session) return;
    interaction = null;
    delete sidebar!.dataset.previewDragging;
    delete sidebar!.dataset.previewResizing;
    if (session.target.hasPointerCapture(session.pointerId)) {
      session.target.releasePointerCapture(session.pointerId);
    }
    if (!session.moving || !available()) return;
    if (cancelled) {
      apply(session.initialState);
      return;
    }
    if (session.kind === "drag") {
      const rect = panel!.getBoundingClientRect();
      const mode = getPreviewDockMode(rect.left, rect.width, view!.innerWidth);
      if (mode !== "floating") apply({ ...state, mode });
    }
    preference.setState(state);
  }

  function onPointerDown(event: PointerEvent, target: HTMLElement, edge?: PreviewResizeEdge): void {
    if (!available() || interaction || !event.isPrimary || event.button !== 0) return;
    if (edge && state.mode !== "floating"
      && edge !== (state.mode === "docked-right" ? "w" : "e")) return;
    geometry = environment();
    const rect = panel!.getBoundingClientRect();
    const session: PointerSession = {
      pointerId: event.pointerId,
      target,
      start: { x: event.clientX, y: event.clientY },
      origin: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      initialState: { ...state },
      moving: false,
    };
    interaction = edge ? { ...session, kind: "resize", edge } : { ...session, kind: "drag" };
    if (edge) sidebar!.dataset.previewResizing = edge;
    target.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!available() || !interaction || interaction.pointerId !== event.pointerId) return;
    const session = interaction;
    const point = { x: event.clientX, y: event.clientY };
    if (session.kind === "drag") {
      if (!session.moving && !hasPreviewDragStarted(session.start, point)) return;
      if (!session.moving) {
        const { limits } = geometry;
        const size = clampPreviewSize({ width: state.floatingWidth ?? session.origin.width, height: state.floatingHeight ?? session.origin.height }, limits);
        session.dragOrigin = getPreviewDetachPosition(session.start, session.origin, size);
        state = { ...state, floatingWidth: size.width, floatingHeight: size.height };
      }
      sidebar!.dataset.previewDragging = "true";
      apply({ ...state, mode: "floating", ...getPreviewDragPosition(session.start, point, session.dragOrigin ?? session.origin) });
    } else {
      const { viewport, limits } = geometry;
      const delta = { x: point.x - session.start.x, y: point.y - session.start.y };
      if (state.mode === "floating") {
        const rect = resizePreviewRect(session.origin, session.edge, delta, viewport, limits);
        apply({ ...state, x: rect.x, y: rect.y, floatingWidth: rect.width, floatingHeight: rect.height });
      } else {
        apply({ ...state, dockedWidth: resizeDockedWidth(session.origin.width, state.mode, delta.x, limits) });
      }
    }
    session.moving = true;
    event.preventDefault();
  }

  function onPointerUp(event: PointerEvent): void {
    if (interaction?.pointerId !== event.pointerId) return;
    if (interaction.moving) onPointerMove(event);
    finish(false);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (interaction?.pointerId === event.pointerId) finish(true);
  }

  function cancelInteraction(): void { finish(true); }

  function onResize(): void {
    if (!available()) return;
    cancelInteraction();
    geometry = environment();
    apply(state);
    preference.setState(state);
  }

  function dispose(): void {
    if (disposed) return;
    // Clear capture before aborting its listeners; finish clears the session first.
    cancelInteraction();
    disposed = true;
    listeners.abort();
    controlsObserver.disconnect();
    for (const region of resizeRegions) region.remove();
    controllers.delete(sidebar!);
  }

  handle.removeAttribute("aria-hidden");
  handle.setAttribute("role", "group");
  handle.setAttribute("aria-label", accessibleLabel);
  const resizeRegions: HTMLElement[] = [];
  const controlsObserver = new MutationObserver(onResize);
  if (laboratoryControls) controlsObserver.observe(laboratoryControls, { attributes: true, attributeFilter: ["hidden"] });
  for (const edge of ["n", "s", "e", "w", "nw", "ne", "sw", "se"] as const) {
    const region = doc.createElement("div");
    region.className = "card-preview-resize-region";
    region.dataset.previewResize = edge;
    region.setAttribute("aria-hidden", "true");
    panel.append(region);
    resizeRegions.push(region);
    region.addEventListener("pointerdown", (event) => onPointerDown(event, region, edge), options);
  }
  handle.addEventListener("pointerdown", (event) => onPointerDown(event, handle), options);
  sidebar.addEventListener("pointermove", onPointerMove, options);
  sidebar.addEventListener("pointerup", onPointerUp, options);
  sidebar.addEventListener("pointercancel", onPointerCancel, options);
  sidebar.addEventListener("lostpointercapture", onPointerCancel, options);
  view.addEventListener("resize", onResize, options);
  view.addEventListener("blur", cancelInteraction, options);
  view.addEventListener("pagehide", cancelInteraction, options);
  doc.addEventListener("visibilitychange", () => { if (doc.hidden) cancelInteraction(); }, options);
  view.addEventListener("keydown", (event) => {
    if (interaction && event.key === "Escape") {
      event.preventDefault();
      cancelInteraction();
    }
  }, options);

  const controller: PreviewPanelController = { getState: () => ({ ...state }), cancelInteraction, dispose };
  controllers.set(sidebar, controller);
  apply(state);
  return controller;
}
