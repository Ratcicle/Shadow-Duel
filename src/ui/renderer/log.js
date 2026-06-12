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
export function updatePhaseTrack(currentPhase, game = null) {
  const phases = this.elements.phaseTrack?.querySelectorAll("li");
  if (!phases) return;
  const phaseOrder =
    game?.canEnterBattlePhase?.() === false
      ? ["draw", "standby", "main1", "main2", "end"]
      : ["draw", "standby", "main1", "battle", "main2", "end"];
  const currentIdx = phaseOrder.indexOf(currentPhase);
  phases.forEach((li) => {
    li.classList.remove("active", "done");
    if (li.dataset.phase === currentPhase) {
      li.classList.add("active");
      return;
    }
    const phaseIdx = phaseOrder.indexOf(li.dataset.phase);
    if (currentIdx >= 0 && phaseIdx >= 0 && phaseIdx < currentIdx) {
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

  if (
    typeof this.ensureLpDisplayState === "function" &&
    typeof this.getDisplayedLp === "function" &&
    typeof this.setDisplayedLp === "function"
  ) {
    const state = this.ensureLpDisplayState(player);
    if (state?.animating || state?.queue?.length > 0) {
      const displayed = this.getDisplayedLp(player);
      if (displayed != null) {
        el.textContent = displayed;
      }
      return;
    }

    if (state) {
      state.holdFinalUntilReal = false;
    }
    this.setDisplayedLp(player, player.lp);
    return;
  }

  el.textContent = player.lp;
}
