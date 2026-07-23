/**
 * Preview methods for Renderer
 * Handles: renderPreview, bindPreviewForElement, createCardElement
 */

import {
  formatCardKindSubtypeLine,
  formatCardPreviewDescriptionHtml,
  formatMonsterDetailHtml,
  formatMonsterStatsLine,
  getCardDisplayDescription,
  getCardDisplayName,
  getCounterDisplayLabel,
  getUIText,
} from "../../core/i18n.js";
import { publicAssetUrl } from "../../core/publicUrl.js";
import {
  CARD_STATUS_ICONS,
  PANEL_ICONS,
  createTablerIcon,
} from "../icons/tablerIcons.js";

const COUNTER_TOOLTIP_METADATA_CACHE = new Map();

function getStatValue(statText) {
  return String(statText || "-").replace(/^[^:]+:\s*/, "") || "-";
}

function renderPreviewStat(element, iconUrl, label, statText) {
  element.replaceChildren();
  const value = getStatValue(statText);
  const icon = createTablerIcon(iconUrl, "panel-stat-icon", { decorative: true });
  const valueElement = document.createElement("span");
  valueElement.className = "panel-stat-value";
  valueElement.textContent = value;
  element.append(icon, valueElement);
  element.title = label;
  element.setAttribute("aria-label", `${label}: ${value}`);
}

function clearPreviewStat(element) {
  element.replaceChildren();
  element.removeAttribute("title");
  element.removeAttribute("aria-label");
}

function hasAttackRestriction(card, turnCounter) {
  if (card?.cannotAttackThisTurn === true) return true;
  return (
    Number.isFinite(card?.cannotAttackUntilTurn) &&
    Number.isFinite(turnCounter) &&
    card.cannotAttackUntilTurn >= turnCounter
  );
}

function createCardStatusIcons(card, turnCounter) {
  if (card?.cardKind !== "monster" || card.isFacedown) return null;

  const statuses = [];
  if (card.effectsNegated === true) {
    statuses.push({
      className: "card-status-icon--negated",
      icon: CARD_STATUS_ICONS.effectsNegated,
      label: getUIText("ui.status.effectsNegated"),
    });
  }
  if (hasAttackRestriction(card, turnCounter)) {
    statuses.push({
      className: "card-status-icon--cannot-attack",
      icon: CARD_STATUS_ICONS.cannotAttack,
      label: getUIText("ui.status.cannotAttack"),
    });
  }
  if (!statuses.length) return null;

  const container = document.createElement("div");
  container.className = "card-status-icons";
  statuses.forEach((status) => {
    const badge = document.createElement("span");
    badge.className = `card-status-icon ${status.className}`;
    badge.setAttribute("role", "img");
    badge.setAttribute("aria-label", status.label);
    badge.title = status.label;
    badge.appendChild(
      createTablerIcon(status.icon, "card-status-icon-glyph", { decorative: true }),
    );
    container.appendChild(badge);
  });
  return container;
}

const COUNTER_LABEL_STOP_WORDS =
  /(\s+(a|ao|aos|e|à|às|neste|nesta|nesse|nessa|nele|nela|neles|nelas|deste|desta|desse|dessa|dele|dela|deles|delas|este|esta|esse|essa|card|carta|conforme|quando|enquanto|para|por|em|no|na|nos|nas|que|se)\b.*)$/iu;

function normalizeCounterLabelKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();
}

function pluralizePortugueseCounterLabel(label) {
  const normalized = String(label || "").trim();
  const match = normalized.match(/^(Marcador|Contador)\s+(.+)$/iu);
  if (!match) return normalized;

  const pluralBase = "Marcadores";
  const suffix = match[2].trim();
  if (/^de\s+/iu.test(suffix) || /^do\s+/iu.test(suffix) || /^da\s+/iu.test(suffix)) {
    return `${pluralBase} ${suffix}`;
  }

  const suffixParts = suffix.split(/\s+/);
  if (suffixParts.length > 1) {
    return `${pluralBase} ${suffix}`;
  }

  const pluralSuffix = suffixParts
    .map((word) => {
      if (/s$/iu.test(word)) return word;
      if (/[rz]$/iu.test(word)) return `${word}es`;
      return `${word}s`;
    })
    .join(" ");

  return `${pluralBase} ${pluralSuffix}`;
}

function pluralizeEnglishCounterLabel(label) {
  return String(label || "")
    .trim()
    .replace(/\bCounters$/i, "Counters")
    .replace(/\bcounters$/i, "counters")
    .replace(/\bCounter$/i, "Counters")
    .replace(/\bcounter$/i, "counters");
}

function uniqueCounterLabels(labels) {
  const seen = new Set();
  return labels.filter((label) => {
    const key = normalizeCounterLabelKey(label);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractPortugueseCounterLabels(description) {
  const labels = [];
  const pattern = /\b(?:Marcador(?:es)?|Contador(?:es)?)\b/giu;

  for (const match of description.matchAll(pattern)) {
    const start = match.index ?? 0;
    const segment = description.slice(start, start + 80).split(/[.;:,]/)[0];
    const trimmed = segment.replace(COUNTER_LABEL_STOP_WORDS, "").trim();
    if (!/\s/.test(trimmed)) continue;
    labels.push(pluralizePortugueseCounterLabel(trimmed));
  }

  return uniqueCounterLabels(labels);
}

function extractEnglishCounterLabels(description) {
  const labels = [];
  const pattern =
    /\b([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*)*\s+[Cc]ounters?)\b/g;

  for (const match of description.matchAll(pattern)) {
    labels.push(pluralizeEnglishCounterLabel(match[1]));
  }

  return uniqueCounterLabels(labels);
}

function extractCounterLabels(description) {
  const text = String(description || "");
  if (!text) return [];
  return uniqueCounterLabels([
    ...extractPortugueseCounterLabels(text),
    ...extractEnglishCounterLabels(text),
  ]);
}

function getCounterAmount(card, counterType) {
  if (!card || !counterType) return 0;
  if (typeof card.getCounter === "function") return card.getCounter(counterType) || 0;
  const counters = card.counters;
  if (counters instanceof Map) return counters.get(counterType) || 0;
  if (counters && typeof counters === "object") return counters[counterType] || 0;
  return 0;
}

function collectCounterTypesFromValue(value, counterTypes, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry) => collectCounterTypesFromValue(entry, counterTypes, seen));
    return;
  }

  Object.entries(value).forEach(([key, entry]) => {
    if (key === "counterType" && typeof entry === "string" && entry.trim()) {
      counterTypes.add(entry.trim());
      return;
    }
    collectCounterTypesFromValue(entry, counterTypes, seen);
  });
}

function collectLiveCounterTypes(card) {
  const counterTypes = new Set();

  const counters = card?.counters;
  if (counters instanceof Map) {
    counters.forEach((amount, counterType) => {
      if (amount > 0 && counterType) counterTypes.add(counterType);
    });
  } else if (counters && typeof counters === "object") {
    Object.entries(counters).forEach(([counterType, amount]) => {
      if (amount > 0 && counterType) counterTypes.add(counterType);
    });
  }

  return [...counterTypes];
}

function humanizeCounterType(counterType) {
  return String(counterType || "counter")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getLocalizedCounterTypeLabel(counterType) {
  const key = String(counterType || "").trim();
  if (!key) return "";
  return getCounterDisplayLabel(key, 2) || getUIText(`ui.counters.labels.${key}`, {}, "");
}

function getCounterTooltipMetadata(card) {
  const localizedDescription = getCardDisplayDescription(card) || "";
  const fallbackDescription = card?.description || "";
  const cacheKey = [
    card?.id ?? card?.name ?? "",
    localizedDescription,
    fallbackDescription,
  ].join("|");

  const cached = COUNTER_TOOLTIP_METADATA_CACHE.get(cacheKey);
  if (cached) return cached;

  const effectCounterTypes = new Set();
  collectCounterTypesFromValue(card?.effects, effectCounterTypes);
  const localizedLabels = extractCounterLabels(localizedDescription);
  const fallbackLabels = extractCounterLabels(fallbackDescription);
  const metadata = {
    effectCounterTypes: [...effectCounterTypes],
    labels: localizedLabels.length ? localizedLabels : fallbackLabels,
  };

  COUNTER_TOOLTIP_METADATA_CACHE.set(cacheKey, metadata);
  return metadata;
}

function resolveCounterLabel(metadata, counterType, index) {
  const localizedCounterTypeLabel = getLocalizedCounterTypeLabel(counterType);
  if (localizedCounterTypeLabel) return localizedCounterTypeLabel;

  const labels = metadata?.labels || [];

  if (labels.length === 1) return labels[0];

  const counterTypeKey = normalizeCounterLabelKey(counterType);
  const matched = labels.find((label) =>
    normalizeCounterLabelKey(label).includes(counterTypeKey),
  );
  if (matched) return matched;

  return labels[index] || `${humanizeCounterType(counterType)} Counters`;
}

function buildCounterTooltip(card) {
  const metadata = getCounterTooltipMetadata(card);
  const counterTypes = [
    ...new Set([
      ...(metadata?.effectCounterTypes || []),
      ...collectLiveCounterTypes(card),
    ]),
  ].filter((counterType) => getCounterAmount(card, counterType) > 0);
  if (counterTypes.length === 0) return "";

  return counterTypes
    .map((counterType, index) => {
      const label = resolveCounterLabel(metadata, counterType, index);
      return `${label}: ${getCounterAmount(card, counterType)}`;
    })
    .join("\n");
}

function getFloatingCounterTooltip() {
  let tooltip = document.querySelector(".floating-counter-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "floating-counter-tooltip";
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

const FLOATING_COUNTER_TOOLTIP_CLEANUP_MS = 160;
let floatingCounterTooltipCleanupTimer = null;

function clearFloatingCounterTooltipCleanupTimer() {
  if (!floatingCounterTooltipCleanupTimer) return;
  window.clearTimeout(floatingCounterTooltipCleanupTimer);
  floatingCounterTooltipCleanupTimer = null;
}

function resetFloatingCounterTooltip(tooltip) {
  if (!tooltip || tooltip.classList.contains("visible")) return;
  tooltip.textContent = "";
  tooltip.style.left = "";
  tooltip.style.top = "";
}

function positionFloatingCounterTooltip(tooltip, anchor) {
  if (!tooltip || !anchor) return;

  const rect = anchor.getBoundingClientRect();
  const gap = 8;
  const margin = 8;
  const tooltipWidth = tooltip.offsetWidth || 0;
  const tooltipHeight = tooltip.offsetHeight || 0;
  const maxLeft = Math.max(margin, window.innerWidth - tooltipWidth - margin);
  const left = Math.min(
    Math.max(margin, rect.left + rect.width / 2 - tooltipWidth / 2),
    maxLeft,
  );
  const top = Math.max(margin, rect.top - tooltipHeight - gap);

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function showFloatingCounterTooltip(anchor) {
  const text = anchor?.dataset?.counterTooltip || "";
  if (!text) {
    clearFloatingCounterTooltip();
    return;
  }

  clearFloatingCounterTooltipCleanupTimer();
  const tooltip = getFloatingCounterTooltip();
  tooltip.textContent = text;
  positionFloatingCounterTooltip(tooltip, anchor);
  tooltip.classList.add("visible");
}

function hideFloatingCounterTooltip() {
  clearFloatingCounterTooltip();
}

const PREVIEW_CARD_FRAME_CLASSES = [
  "preview-card-monster",
  "preview-card-fusion",
  "preview-card-synchro",
  "preview-card-ascension",
  "preview-card-spell",
  "preview-card-trap",
];

const PREVIEW_STAT_MOD_CLASSES = [
  "preview-stat-buff",
  "preview-stat-debuff",
];

function getPreviewCardFrameClass(card) {
  if (card?.cardKind === "spell") return "preview-card-spell";
  if (card?.cardKind === "trap") return "preview-card-trap";
  if (card?.monsterType === "fusion") return "preview-card-fusion";
  if (card?.monsterType === "synchro") return "preview-card-synchro";
  if (card?.monsterType === "ascension") return "preview-card-ascension";
  return "preview-card-monster";
}

function setPreviewCardFrameClass(element, card) {
  if (!element) return;
  element.classList.remove(...PREVIEW_CARD_FRAME_CLASSES);
  element.classList.add(getPreviewCardFrameClass(card));
}

function getPreviewStatModifierClass(card, stat) {
  const current = Number(card?.[stat]);
  const baseStatKey = `base${stat.charAt(0).toUpperCase()}${stat.slice(1)}`;
  const base = Number(card?.[baseStatKey]);
  if (!Number.isFinite(current) || !Number.isFinite(base)) return "";
  if (current > base) return "preview-stat-buff";
  if (current < base) return "preview-stat-debuff";
  return "";
}

function getCardStatModifierClass(card, stat) {
  const modifierClass = getPreviewStatModifierClass(card, stat);
  if (modifierClass === "preview-stat-buff") return "stat-buff";
  if (modifierClass === "preview-stat-debuff") return "stat-debuff";
  return "";
}

function setPreviewStatModifierClass(element, card, stat) {
  if (!element) return;
  element.classList.remove(...PREVIEW_STAT_MOD_CLASSES);
  const modifierClass = getPreviewStatModifierClass(card, stat);
  if (modifierClass) {
    element.classList.add(modifierClass);
  }
}

export function clearFloatingCounterTooltip() {
  const tooltip = document.querySelector(".floating-counter-tooltip");
  if (!tooltip) return;
  clearFloatingCounterTooltipCleanupTimer();
  tooltip.classList.remove("visible");
  floatingCounterTooltipCleanupTimer = window.setTimeout(() => {
    floatingCounterTooltipCleanupTimer = null;
    resetFloatingCounterTooltip(tooltip);
  }, FLOATING_COUNTER_TOOLTIP_CLEANUP_MS);
}

function bindCounterTooltipForElement(element) {
  if (!element || element.dataset.counterTooltipBound === "true") return;
  element.dataset.counterTooltipBound = "true";
  element.addEventListener("mouseenter", () => showFloatingCounterTooltip(element));
  element.addEventListener("mousemove", () => {
    const tooltip = document.querySelector(".floating-counter-tooltip.visible");
    if (tooltip) positionFloatingCounterTooltip(tooltip, element);
  });
  element.addEventListener("mouseleave", hideFloatingCounterTooltip);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function renderPreview(card) {
  const previewImage = document.getElementById("preview-image");
  const previewName = document.getElementById("preview-name");
  const previewAtk = document.getElementById("preview-atk");
  const previewDef = document.getElementById("preview-def");
  const previewLevel = document.getElementById("preview-level");
  const previewDesc = document.getElementById("preview-desc");

  if (
    !previewImage ||
    !previewName ||
    !previewAtk ||
    !previewDef ||
    !previewLevel ||
    !previewDesc
  ) {
    return;
  }

  if (!card) {
    previewImage.style.backgroundImage = "";
    setPreviewCardFrameClass(previewImage, null);
    previewName.textContent = "Hover a card";
    renderPreviewStat(previewAtk, PANEL_ICONS.atk, getUIText("ui.icons.atk"), "-");
    renderPreviewStat(previewDef, PANEL_ICONS.def, getUIText("ui.icons.def"), "-");
    setPreviewStatModifierClass(previewAtk, null, "atk");
    setPreviewStatModifierClass(previewDef, null, "def");
    previewLevel.textContent = "Level: -";
    previewDesc.textContent = "Description will appear here.";
    return;
  }

  previewImage.style.backgroundImage = `url('${publicAssetUrl(card.image)}')`;
  setPreviewCardFrameClass(previewImage, card);
  previewName.textContent =
    getCardDisplayName(card) || (card?.name && card.name) || "Hover a card";
  const isMonster = card.cardKind !== "spell" && card.cardKind !== "trap";

  if (isMonster) {
    const stats = formatMonsterStatsLine(card);
    previewLevel.innerHTML = formatMonsterDetailHtml(card);
    renderPreviewStat(previewAtk, PANEL_ICONS.atk, getUIText("ui.icons.atk"), stats.atk);
    renderPreviewStat(previewDef, PANEL_ICONS.def, getUIText("ui.icons.def"), stats.def);
    setPreviewStatModifierClass(previewAtk, card, "atk");
    setPreviewStatModifierClass(previewDef, card, "def");
  } else {
    previewLevel.textContent = formatCardKindSubtypeLine(card);
    clearPreviewStat(previewAtk);
    clearPreviewStat(previewDef);
    setPreviewStatModifierClass(previewAtk, null, "atk");
    setPreviewStatModifierClass(previewDef, null, "def");
  }
  previewDesc.innerHTML = formatCardPreviewDescriptionHtml(
    card,
    "No description available.",
  );
}

/**
 * Binds preview behavior to an element.
 *
 * For board cards (those with dataset.location set after creation), preview is
 * handled centrally by Game.js via bindCardHover to properly enforce facedown
 * visibility rules. This method only binds preview for "isolated" elements
 * (modals, GY preview, Extra Deck preview) that don't go through Game.js flow.
 *
 * @this {import('../Renderer.js').default}
 */
export function bindPreviewForElement(element, card, visible = true) {
  if (!element) return;
  element.dataset.previewable = visible ? "true" : "false";
  element.__cardData = visible ? card : null;

  // Defer listener attachment to allow board.js to set dataset.location first.
  // If element ends up being a board card (has location), skip local preview
  // binding - Game.js handles it via bindCardHover with proper facedown checks.
  requestAnimationFrame(() => {
    if (element.dataset.location) {
      // Board card - Game.js is the source of truth for preview
      return;
    }
    // Isolated element (modal, GY preview, etc.) - safe to bind local preview
    element.addEventListener("mouseenter", () => {
      this.renderPreview(visible ? card : null);
    });
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function createCardElement(card, visible, options = {}) {
  // Defensive: skip rendering when card data is missing to avoid UI crashes
  if (!card) {
    const placeholder = document.createElement("div");
    placeholder.className = "card placeholder";
    placeholder.dataset.previewable = "false";
    return placeholder;
  }

  const el = document.createElement("div");
  el.className = "card";
  if (card.instanceId != null) {
    el.dataset.cardKey = String(card.instanceId);
    if (this.activeAttackAnimationKeys?.has(String(card.instanceId))) {
      el.dataset.attackLungeHidden = "true";
      el.dataset.attackLungeVisibility = "";
      el.style.visibility = "hidden";
    }
  }
  this.bindPreviewForElement(el, card, visible);
  if (card.cardKind === "spell") {
    el.classList.add("card-spell");
  } else if (card.cardKind === "trap") {
    el.classList.add("card-trap");
  } else {
    el.classList.add("card-monster");
    const monsterType = (card.monsterType || "").toLowerCase();
    if (monsterType === "fusion") {
      el.classList.add("card-monster-fusion");
    } else if (monsterType === "synchro") {
      el.classList.add("card-monster-synchro");
    } else if (monsterType === "ascension") {
      el.classList.add("card-monster-ascension");
    }
  }

  if (visible) {
    const isMonster = card.cardKind !== "spell" && card.cardKind !== "trap";
    const displayName =
      getCardDisplayName(card) || (card?.name && card.name.trim()) || "";
    const stars = "*".repeat(card.level || 0);
    const typeLabel = isMonster ? stars : formatCardKindSubtypeLine(card);

    const displayDescription =
      getCardDisplayDescription(card) ||
      (card?.description && card.description.trim()) ||
      "Effect card.";

    const bgStyle = card.image
      ? `background-image: url('${publicAssetUrl(card.image)}'); background-size: cover; background-position: center;`
      : "background: #1f2937;";

    el.innerHTML = `
      <div class="card-header">
        <div class="card-name">${displayName}</div>
      </div>
      <div class="card-image" style="${bgStyle}"></div>
      ${
        isMonster
          ? `<div class="card-stats">
               <span class="stat-atk ${getCardStatModifierClass(card, "atk")}">${card.atk}</span>
               <span class="stat-def ${getCardStatModifierClass(card, "def")}">${card.def}</span>
             </div>`
          : `<div class="card-type">${typeLabel}</div>`
      }
    `;
    const statusIcons = options.showStatusIcons
      ? createCardStatusIcons(card, options.turnCounter)
      : null;
    if (statusIcons) el.appendChild(statusIcons);
  }

  const storedBlueprints = card?.state?.blueprintStorage?.storedBlueprints;
  const tooltipLines = [];
  const counterTooltip = visible ? buildCounterTooltip(card) : "";
  if (counterTooltip) {
    el.dataset.counterTooltip = counterTooltip;
    bindCounterTooltipForElement(el);
    tooltipLines.push(counterTooltip);
  }

  if (visible && Array.isArray(storedBlueprints) && storedBlueprints.length) {
    const storedNames = storedBlueprints
      .map((bp) => bp.displayName || bp.sourceCardName || bp.blueprintId)
      .filter(Boolean);
    if (storedNames.length) {
      tooltipLines.push(`Efeito armazenado: ${storedNames.join(", ")}`);
    }
  }

  if (tooltipLines.length) {
    const baseTooltip = tooltipLines.join("\n");
    el.dataset.baseTooltip = baseTooltip;
    el.title = baseTooltip;
  }

  return el;
}
