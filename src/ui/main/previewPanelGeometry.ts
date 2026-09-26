export interface PreviewPoint { x: number; y: number }
export interface PreviewSize { width: number; height: number }
export interface PreviewRect extends PreviewPoint, PreviewSize {}
export type PreviewResizeEdge = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
export interface PreviewSizeLimits {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
}

export const PREVIEW_VIEWPORT_MARGIN = 8;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

export function getPreviewSizeLimits(viewport: PreviewSize, defaults: PreviewSize, contentInset = 0): PreviewSizeLimits {
  const availableWidth = Math.max(1, viewport.width - 2 * PREVIEW_VIEWPORT_MARGIN);
  const maxHeight = Math.max(1, viewport.height - 2 * PREVIEW_VIEWPORT_MARGIN);
  // Retain the approved narrow breakpoint defaults; resizing never forces a wider panel.
  const minWidth = Math.min(240, defaults.width, availableWidth);
  return {
    minWidth,
    maxWidth: Math.min(520, Math.max(minWidth, viewport.width * 0.45), availableWidth),
    minHeight: Math.min(520 + contentInset, maxHeight),
    maxHeight,
  };
}

export function clampPreviewSize(size: PreviewSize, limits: PreviewSizeLimits): PreviewSize {
  return {
    width: clamp(size.width, limits.minWidth, limits.maxWidth),
    height: clamp(size.height, limits.minHeight, limits.maxHeight),
  };
}

export function clampPreviewPosition(point: PreviewPoint, panel: PreviewSize, viewport: PreviewSize, margin = PREVIEW_VIEWPORT_MARGIN): PreviewPoint {
  return {
    x: Math.max(margin, Math.min(point.x, viewport.width - margin - panel.width)),
    y: Math.max(margin, Math.min(point.y, viewport.height - margin - panel.height)),
  };
}

export function resizePreviewRect(origin: PreviewRect, edge: PreviewResizeEdge, delta: PreviewPoint, viewport: PreviewSize, limits: PreviewSizeLimits): PreviewRect {
  const result = { ...origin };
  const margin = PREVIEW_VIEWPORT_MARGIN;
  if (edge.includes("w")) {
    const right = origin.x + origin.width;
    result.width = clamp(origin.width - delta.x, limits.minWidth, Math.min(limits.maxWidth, right - margin));
    result.x = right - result.width;
  } else if (edge.includes("e")) {
    result.width = clamp(origin.width + delta.x, limits.minWidth, Math.min(limits.maxWidth, viewport.width - margin - origin.x));
  }
  if (edge.includes("n")) {
    const bottom = origin.y + origin.height;
    result.height = clamp(origin.height - delta.y, limits.minHeight, Math.min(limits.maxHeight, bottom - margin));
    result.y = bottom - result.height;
  } else if (edge.includes("s")) {
    result.height = clamp(origin.height + delta.y, limits.minHeight, Math.min(limits.maxHeight, viewport.height - margin - origin.y));
  }
  return result;
}

export function resizeDockedWidth(width: number, mode: "docked-left" | "docked-right", deltaX: number, limits: PreviewSizeLimits): number {
  return clamp(width + (mode === "docked-left" ? deltaX : -deltaX), limits.minWidth, limits.maxWidth);
}

export function getPreviewDetachPosition(start: PreviewPoint, origin: PreviewRect, floating: PreviewSize): PreviewPoint {
  return { x: start.x - (start.x - origin.x) / origin.width * floating.width, y: origin.y };
}
