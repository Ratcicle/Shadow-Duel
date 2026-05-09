export function createBotArenaController({
  dom,
  startScreenRoot,
  validationPanel,
  BotArena,
  Game,
  Bot,
  ShadowHeartStrategy,
  LuminarchStrategy,
}) {
  let botArenaInstance = null;
  if (typeof window !== "undefined") {
    window.botArenaInstance = null;
  }

  function open() {
    startScreenRoot?.classList.add("hidden");
    dom.modal?.classList.remove("hidden");
    populateDecks();
    resetStats();
  }

  function close() {
    dom.modal?.classList.add("hidden");
    startScreenRoot?.classList.remove("hidden");
    if (botArenaInstance?.isRunning) {
      botArenaInstance.stop();
    }
  }

  function populateDecks() {
    const options = [
      { id: "default", label: "Deck Padrão" },
      ...Bot.getAvailablePresets().map((preset) => ({
        id: preset.id,
        label: preset.label,
      })),
    ];

    dom.deckSeat1Select.innerHTML = "";
    dom.deckSeat2Select.innerHTML = "";

    options.forEach((opt) => {
      const opt1 = document.createElement("option");
      opt1.value = opt.id;
      opt1.textContent = opt.label;
      dom.deckSeat1Select.appendChild(opt1);

      const opt2 = document.createElement("option");
      opt2.value = opt.id;
      opt2.textContent = opt.label;
      dom.deckSeat2Select.appendChild(opt2);
    });

    dom.deckSeat1Select.value = "shadowheart";
    dom.deckSeat2Select.value = "luminarch";
  }

  function resetStats() {
    dom.completed.textContent = "0";
    dom.wins1.textContent = "0";
    dom.wins2.textContent = "0";
    dom.draws.textContent = "0";
    dom.avgTurns.textContent = "-";
    dom.status.textContent = "Pronto";
    dom.log.innerHTML = '<p class="log-entry">Aguardando início...</p>';
    if (dom.exportStrategicButton) {
      dom.exportStrategicButton.disabled =
        !botArenaInstance?.getAnalytics?.()?.duelRecords?.length;
    }
  }

  async function start() {
    if (!validationPanel.run()) {
      return;
    }

    const preset1 = dom.deckSeat1Select.value;
    const preset2 = dom.deckSeat2Select.value;
    const numDuels = parseInt(dom.numDuelsSelect.value) || 10;
    const speed = dom.speedSelect.value || "1x";
    const autoPause = dom.autoPauseCheckbox?.checked || false;

    dom.startButton.disabled = true;
    dom.cancelButton.disabled = true;
    resetStats();
    if (dom.exportStrategicButton) {
      dom.exportStrategicButton.disabled = true;
    }
    dom.status.textContent = "Executando...";

    dom.modal.classList.add("hidden");
    startScreenRoot?.classList.add("hidden");

    botArenaInstance = new BotArena(
      Game,
      Bot,
      ShadowHeartStrategy,
      LuminarchStrategy,
    );
    if (typeof window !== "undefined") {
      window.botArenaInstance = botArenaInstance;
    }

    try {
      await botArenaInstance.startArena(
        preset1,
        preset2,
        numDuels,
        speed,
        autoPause,
        (progress) => updateProgress(progress),
        (result) => finish(result),
      );
    } catch (err) {
      console.error("Bot Arena error:", err);
      alert(`Erro na arena: ${err.message}`);
      dom.status.textContent = "Erro";
      dom.startButton.disabled = false;
      dom.cancelButton.disabled = false;
      if (dom.exportStrategicButton) {
        dom.exportStrategicButton.disabled = true;
      }
    }
  }

  function updateProgress(progress) {
    dom.completed.textContent = progress.completed.toString();
    dom.wins1.textContent = progress.wins1.toString();
    dom.wins2.textContent = progress.wins2.toString();
    dom.draws.textContent = progress.draws.toString();
    dom.avgTurns.textContent = progress.avgTurns;

    const result = progress.lastResult;
    if (result) {
      if (result.type === "error") {
        addLogEntry(`❌ ${result.message}`, "error");
      } else {
        let className;
        let winnerText;

        if (result.winner === "player") {
          className = "win-1";
          winnerText = "Bot 1 venceu";
          addLogEntry(
            `Duel ${result.duelNumber}: ✅ ${winnerText} (${result.turns} turnos)`,
            className,
          );
          return;
        } else if (result.winner === "bot") {
          className = "win-2";
          winnerText = "Bot 2 venceu";
          addLogEntry(
            `Duel ${result.duelNumber}: ❌ ${winnerText} (${result.turns} turnos)`,
            className,
          );
          return;
        } else {
          className = "draw";
          winnerText = "Empate";
          addLogEntry(
            `Duel ${result.duelNumber}: 🔄 ${winnerText} (${result.turns} turnos)`,
            className,
          );
          return;
        }
      }
    }
  }

  function addLogEntry(text, className = "") {
    if (!dom.log) return;

    if (
      dom.log.children.length === 1 &&
      dom.log.children[0].textContent === "Aguardando início..."
    ) {
      dom.log.innerHTML = "";
    }

    const entry = document.createElement("p");
    entry.className = `log-entry ${className}`;
    entry.textContent = text;
    dom.log.appendChild(entry);
    dom.log.scrollTop = dom.log.scrollHeight;
  }

  function finish(result) {
    dom.startButton.disabled = false;
    dom.cancelButton.disabled = false;
    if (dom.exportStrategicButton) {
      dom.exportStrategicButton.disabled = !botArenaInstance
        ?.getAnalytics?.()
        ?.duelRecords?.length;
    }
    dom.status.textContent = "Concluído";
    addLogEntry(`✔️ Arena concluída! ${result.completed} duelos.`);
    dom.modal.classList.remove("hidden");
  }

  function downloadStrategicReport() {
    if (!botArenaInstance?.getAnalytics?.()?.duelRecords?.length) {
      addLogEntry("Nenhum relatório estratégico disponível ainda.", "error");
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    botArenaInstance.downloadStrategicReport(
      `shadow-duel-strategic-report-${stamp}.json`,
    );
  }

  function bind() {
    dom.startButton?.addEventListener("click", start);
    dom.cancelButton?.addEventListener("click", close);
    dom.exportStrategicButton?.addEventListener("click", downloadStrategicReport);
    dom.closeButton?.addEventListener("click", close);
  }

  return {
    bind,
    close,
    getInstance: () => botArenaInstance,
    open,
    start,
  };
}
