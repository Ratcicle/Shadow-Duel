/**
 * Animation methods for Renderer
 * Handles: showLpChange
 */

/**
 * @this {import('../Renderer.js').default}
 */
export function showLpChange(player, amount, options = {}) {
  if (!player || !amount) return;
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) return;

  const isHeal = value > 0;
  const container = document.getElementById(
    player.id === "player" ? "player-area" : "bot-area"
  );
  if (!container) return;

  const float = document.createElement("div");
  float.className = [
    "lp-float",
    isHeal ? "lp-float-heal" : "lp-float-damage",
    player.id === "player" ? "lp-float-player" : "lp-float-bot",
  ].join(" ");
  float.textContent = `${isHeal ? "+" : ""}${Math.abs(value)}`;
  container.appendChild(float);

  requestAnimationFrame(() => {
    float.classList.add("lp-float-animate");
  });

  const lpEl =
    player.id === "player" ? this.elements.playerLP : this.elements.botLP;
  const counter = lpEl ? lpEl.closest(".lp-counter") : null;
  if (counter) {
    const flashClass = isHeal ? "lp-flash-heal" : "lp-flash-damage";
    counter.classList.remove("lp-flash-heal", "lp-flash-damage");
    counter.classList.add(flashClass);
    setTimeout(() => {
      counter.classList.remove(flashClass);
    }, 420);
  }

  setTimeout(() => {
    float.remove();
  }, 1100);
}
