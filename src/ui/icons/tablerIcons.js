import swordsIconUrl from "@tabler/icons/outline/swords.svg";
import shieldIconUrl from "@tabler/icons/outline/shield.svg";
import swordOffIconUrl from "@tabler/icons/outline/sword-off.svg";
import banIconUrl from "@tabler/icons/outline/ban.svg";
import graveyardIconUrl from "@tabler/icons/outline/grave-2.svg";
import extraDeckIconUrl from "@tabler/icons/outline/spiral.svg";
import connectionIconUrl from "@tabler/icons/outline/connection.svg";

export const PANEL_ICONS = Object.freeze({
  atk: swordsIconUrl,
  def: shieldIconUrl,
  graveyard: graveyardIconUrl,
  extraDeck: extraDeckIconUrl,
});

export const CARD_STATUS_ICONS = Object.freeze({
  cannotAttack: swordOffIconUrl,
  effectsNegated: banIconUrl,
});

export const EQUIP_LINK_ICONS = Object.freeze({
  equipped: connectionIconUrl,
});

export function createTablerIcon(iconUrl, className = "", options = {}) {
  const icon = document.createElement("span");
  icon.className = ["tabler-icon", className].filter(Boolean).join(" ");
  icon.style.setProperty("--tabler-icon", `url("${iconUrl}")`);

  if (options.decorative) {
    icon.setAttribute("aria-hidden", "true");
  } else if (options.label) {
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", options.label);
    icon.title = options.label;
  }

  return icon;
}
