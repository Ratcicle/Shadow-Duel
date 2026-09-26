import type { FieldPlacementMode } from "../../core/contracts/placement.js";
import { getUIText } from "../../core/i18n.js";

const PLACEMENT_STORAGE_KEY = "shadow_duel_card_placement";

/** Browser preference only. Headless games and replay never read this storage. */
export function createPlacementPreference() {
  let mode: FieldPlacementMode = "automatic";
  try {
    if (localStorage.getItem(PLACEMENT_STORAGE_KEY) === "manual") mode = "manual";
  } catch {
    // Storage is optional; keep the current in-memory preference usable.
  }
  const getMode = () => mode;
  const setMode = (value: string) => {
    mode = value === "manual" ? "manual" : "automatic";
    try {
      localStorage.setItem(PLACEMENT_STORAGE_KEY, mode);
    } catch {
      // The live preference still applies when persistence is unavailable.
    }
  };
  return { getMode, setMode };
}

export function bindPlacementPreference(
  select: HTMLSelectElement | null,
  label: HTMLElement | null,
  preference: ReturnType<typeof createPlacementPreference>,
): void {
  if (label) label.textContent = getUIText("ui.placement.preference");
  if (!select) return;
  for (const option of select.options) {
    option.textContent = getUIText(`ui.placement.${option.value}`);
  }
  select.value = preference.getMode();
  select.onchange = () => preference.setMode(select.value);
}
