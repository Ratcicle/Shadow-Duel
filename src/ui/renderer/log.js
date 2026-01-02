/**
 * Log and status methods for Renderer
 * Handles: log, updateTurn, updatePhaseTrack, updateLP
 */

/**
 * @this {import('../Renderer.js').default}
 */
export function log(message) {
  console.log(message);
  const logList = this.elements.actionLog;
  if (!logList) return;

  const entry = document.createElement("div");
  entry.className = "log-entry";

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  entry.innerHTML = `<span class="log-time">${hh}:${mm}:${ss}</span><span class="log-text">${message}</span>`;
  logList.appendChild(entry);

  const maxEntries = 80;
  while (logList.children.length > maxEntries) {
    logList.removeChild(logList.firstChild);
  }

  logList.scrollTop = logList.scrollHeight;
}

/**
 * @this {import('../Renderer.js').default}
 */
export function updateTurn(player) {
  if (!this.elements.turnIndicator) return;
  this.elements.turnIndicator.textContent = `Turn: ${player.name}`;

  // Indicador visual de turno: borda brilhante no campo do jogador ativo
  const playerAreaEl = document.getElementById("player-area");
  const botAreaEl = document.getElementById("bot-area");
  if (playerAreaEl && botAreaEl) {
    const isPlayerTurn = player.id === "player";
    playerAreaEl.classList.toggle("active-turn", isPlayerTurn);
    botAreaEl.classList.toggle("active-turn", !isPlayerTurn);
  }
}

/**
 * @this {import('../Renderer.js').default}
 */
export function updatePhaseTrack(currentPhase) {
  const phases = this.elements.phaseTrack?.querySelectorAll("li");
  if (!phases) return;
  let reachedCurrent = false;
  phases.forEach((li) => {
    li.classList.remove("active", "done");
    if (li.dataset.phase === currentPhase) {
      li.classList.add("active");
      reachedCurrent = true;
    } else if (!reachedCurrent) {
      li.classList.add("done");
    }
  });
}

/**
 * @this {import('../Renderer.js').default}
 */
export function updateLP(player) {
  const el =
    player.id === "player" ? this.elements.playerLP : this.elements.botLP;
  if (!el) return;
  el.textContent = player.lp;
}
