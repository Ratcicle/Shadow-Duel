import { getUIText } from "../../core/i18n.js";
import { EQUIP_LINK_ICONS, createTablerIcon } from "../icons/tablerIcons.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function getCardIdentity(card) {
  if (!card) return null;
  return card.instanceId ?? card._instanceId ?? card.duelCardId ?? null;
}

function isSameCardReference(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftId = getCardIdentity(left);
  const rightId = getCardIdentity(right);
  return leftId != null && rightId != null && String(leftId) === String(rightId);
}

function isFaceupEquip(card) {
  return (
    card?.cardKind === "spell" &&
    card.subtype === "equip" &&
    card.isFacedown !== true
  );
}

function getBoardCardEntries() {
  return [...document.querySelectorAll("#game-container .card[data-location]")]
    .filter((element) => element.dataset.previewable === "true")
    .map((element) => ({ element, card: element.__cardData }))
    .filter(({ card }) => card);
}

function findCardElement(entries, card) {
  return entries.find((entry) => isSameCardReference(entry.card, card))?.element || null;
}

function collectEquipLinks() {
  const entries = getBoardCardEntries();
  return entries.flatMap(({ element: equipElement, card: equip }) => {
    if (!isFaceupEquip(equip)) return [];

    const target = equip.equippedTo || equip.equipTarget || null;
    const targetElement = findCardElement(entries, target);
    if (
      !targetElement ||
      target?.cardKind !== "monster" ||
      target.isFacedown === true
    ) {
      return [];
    }

    const targetEquips = Array.isArray(target.equips) ? target.equips : [];
    const targetConfirmsEquip = targetEquips.some((attached) =>
      isSameCardReference(attached, equip),
    );
    const equipConfirmsTarget =
      isSameCardReference(equip.equippedTo, target) ||
      isSameCardReference(equip.equipTarget, target);
    if (!targetConfirmsEquip && !equipConfirmsTarget) {
      return [];
    }

    return [{ equipElement, targetElement }];
  });
}

function ensureEquipLinkLayer(renderer) {
  const gameContainer = document.getElementById("game-container");
  if (!gameContainer) return null;

  let layer = gameContainer.querySelector(".equip-link-layer");
  if (!layer) {
    layer = document.createElementNS(SVG_NS, "svg");
    layer.classList.add("equip-link-layer");
    layer.setAttribute("aria-hidden", "true");
    gameContainer.appendChild(layer);
  }

  if (!renderer.equipLinkResizeHandler) {
    renderer.equipLinkResizeHandler = () => renderer.redrawEquipLinks?.();
    window.addEventListener("resize", renderer.equipLinkResizeHandler);
  }

  return layer;
}

function drawEquipLinks(renderer, links = renderer.activeEquipLinks || []) {
  const layer = ensureEquipLinkLayer(renderer);
  if (!layer) return;

  layer.replaceChildren();
  layer.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
  layer.setAttribute("width", String(window.innerWidth));
  layer.setAttribute("height", String(window.innerHeight));

  links.forEach(({ equipElement, targetElement }) => {
    if (!equipElement.isConnected || !targetElement.isConnected) return;
    const equipRect = equipElement.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const line = document.createElementNS(SVG_NS, "line");
    line.classList.add("equip-link-line");
    line.setAttribute("x1", String(equipRect.left + equipRect.width / 2));
    line.setAttribute("y1", String(equipRect.top + equipRect.height / 2));
    line.setAttribute("x2", String(targetRect.left + targetRect.width / 2));
    line.setAttribute("y2", String(targetRect.top + targetRect.height / 2));
    layer.appendChild(line);
  });
}

function clearActiveEquipLinks(renderer) {
  document
    .querySelectorAll(".equip-link-highlight")
    .forEach((element) => element.classList.remove("equip-link-highlight"));
  renderer.activeEquipLinks = [];
  renderer.redrawEquipLinks?.();
}

function activateEquipLinks(renderer, links) {
  clearActiveEquipLinks(renderer);
  renderer.activeEquipLinks = links;
  links.forEach(({ equipElement, targetElement }) => {
    equipElement.classList.add("equip-link-highlight");
    targetElement.classList.add("equip-link-highlight");
  });
  renderer.redrawEquipLinks?.();
}

function addEquipLinkIcon(element, label) {
  if (element.querySelector(".equip-link-icon")) return;
  const icon = createTablerIcon(EQUIP_LINK_ICONS.equipped, "equip-link-icon", {
    label,
  });
  element.appendChild(icon);

  if (!element.hasAttribute("tabindex")) {
    element.tabIndex = 0;
    element.dataset.equipLinkTabindex = "true";
  }
}

function bindEquipLinkInteractions(renderer, element, links) {
  const activate = () => activateEquipLinks(renderer, links);
  const clear = () => {
    if (document.activeElement !== element) clearActiveEquipLinks(renderer);
  };
  element.addEventListener("mouseenter", activate);
  element.addEventListener("mouseleave", clear);
  element.addEventListener("focus", activate);
  element.addEventListener("blur", clear);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function syncEquipLinkIndicators() {
  this.clearEquipLinkIndicators();

  const links = collectEquipLinks();
  if (!links.length) return;

  const linksByElement = new Map();
  links.forEach((link) => {
    for (const element of [link.equipElement, link.targetElement]) {
      const linked = linksByElement.get(element) || [];
      linked.push(link);
      linksByElement.set(element, linked);
    }
  });

  const label = getUIText("ui.status.equipped");
  linksByElement.forEach((linked, element) => {
    addEquipLinkIcon(element, label);
    bindEquipLinkInteractions(this, element, linked);
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function redrawEquipLinks() {
  drawEquipLinks(this);
}

/**
 * @this {import('../Renderer.js').default}
 */
export function clearEquipLinkIndicators() {
  clearActiveEquipLinks(this);
  document.querySelectorAll(".equip-link-icon").forEach((icon) => icon.remove());
  document.querySelectorAll('[data-equip-link-tabindex="true"]').forEach((element) => {
    element.removeAttribute("tabindex");
    delete element.dataset.equipLinkTabindex;
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function destroyEquipLinkIndicators() {
  this.clearEquipLinkIndicators();
  if (this.equipLinkResizeHandler) {
    window.removeEventListener("resize", this.equipLinkResizeHandler);
  }
  this.equipLinkResizeHandler = null;
  document.querySelector(".equip-link-layer")?.remove();
}
