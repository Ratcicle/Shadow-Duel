// ═══════════════════════════════════════════════════════════════════════════
// ReplayDashboard.js - Interface de visualização de replays e insights
// ═══════════════════════════════════════════════════════════════════════════

import {
  replayDatabase,
  replayImporter,
  replayInsights,
  patternMatcher,
} from "../../core/ai/replay/index.js";

/**
 * ReplayDashboard - UI para análise de replays
 *
 * Features:
 *   - Importação drag-drop de múltiplos .json
 *   - Filtros por archetype, matchup, result, quality
 *   - Lista de replays com detalhes
 *   - Insights resumidos (top cards, opening patterns, phase prefs)
 *   - Export JSONL para ML
 */
class ReplayDashboard {
  constructor() {
    this.container = null;
    this.filters = {
      archetype: null,
      matchup: null,
      result: null,
      quality: "clean",
    };
    this.replays = [];
    this.selectedReplay = null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Monta a UI do dashboard
   * @param {HTMLElement} container
   */
  async mount(container) {
    this.container = container;
    container.innerHTML = "";
    container.className = "replay-dashboard";

    // Inicializar database
    await replayDatabase.init();

    // Criar estrutura
    this._createHeader();
    this._createMainContent();

    // Carregar dados
    await this.refresh();
  }

  /**
   * Desmonta a UI
   */
  unmount() {
    if (this.container) {
      this.container.innerHTML = "";
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UI Creation
  // ─────────────────────────────────────────────────────────────────────────

  _createHeader() {
    const header = document.createElement("div");
    header.className = "replay-header";
    header.innerHTML = `
      <h2>📊 Replay Analytics</h2>
      <div class="replay-header-actions">
        <button id="import-btn" class="replay-btn primary">📁 Import</button>
        <button id="export-btn" class="replay-btn">📤 Export JSONL</button>
        <button id="clear-btn" class="replay-btn danger">🗑️ Clear All</button>
      </div>
    `;
    this.container.appendChild(header);

    // Event listeners
    header.querySelector("#import-btn").onclick = () => this._showImportModal();
    header.querySelector("#export-btn").onclick = () => this._exportJSONL();
    header.querySelector("#clear-btn").onclick = () => this._confirmClearAll();

    // Stats bar
    const statsBar = document.createElement("div");
    statsBar.className = "replay-stats-bar";
    statsBar.id = "stats-bar";
    this.container.appendChild(statsBar);
  }

  _createMainContent() {
    const main = document.createElement("div");
    main.className = "replay-main";

    // Sidebar (filters + list)
    const sidebar = document.createElement("div");
    sidebar.className = "replay-sidebar";
    sidebar.innerHTML = `
      <div class="replay-filters">
        <h3>Filters</h3>
        <div class="filter-group">
          <label>Archetype</label>
          <select id="filter-archetype">
            <option value="">All</option>
            <option value="Luminarch">Luminarch</option>
            <option value="Shadow-Heart">Shadow-Heart</option>
            <option value="Dragon">Dragon</option>
            <option value="Void">Void</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Result</label>
          <div class="filter-radios">
            <label><input type="radio" name="result" value="" checked> All</label>
            <label><input type="radio" name="result" value="win"> Wins</label>
            <label><input type="radio" name="result" value="loss"> Losses</label>
          </div>
        </div>
        <div class="filter-group">
          <label>Quality</label>
          <select id="filter-quality">
            <option value="">All</option>
            <option value="clean" selected>Clean only</option>
            <option value="partial">Partial</option>
            <option value="noisy">Noisy</option>
          </select>
        </div>
      </div>
      <div class="replay-list" id="replay-list">
        <h3>Replays</h3>
        <div class="replay-list-items"></div>
      </div>
    `;
    main.appendChild(sidebar);

    // Content area (insights + details)
    const content = document.createElement("div");
    content.className = "replay-content";
    content.innerHTML = `
      <div class="insights-panel" id="insights-panel">
        <h3>Insights</h3>
        <div class="insights-content"></div>
      </div>
      <div class="replay-details" id="replay-details">
        <h3>Replay Details</h3>
        <div class="details-content">
          <p class="placeholder">Select a replay to view details</p>
        </div>
      </div>
    `;
    main.appendChild(content);

    this.container.appendChild(main);

    // Filter event listeners
    sidebar.querySelector("#filter-archetype").onchange = (e) => {
      this.filters.archetype = e.target.value || null;
      this.refresh();
    };
    sidebar.querySelector("#filter-quality").onchange = (e) => {
      this.filters.quality = e.target.value || null;
      this.refresh();
    };
    sidebar.querySelectorAll('input[name="result"]').forEach((radio) => {
      radio.onchange = (e) => {
        this.filters.result = e.target.value || null;
        this.refresh();
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Data Loading
  // ─────────────────────────────────────────────────────────────────────────

  async refresh() {
    // Load replays with filters
    this.replays = await replayDatabase.listReplays(this.filters);

    // Update stats
    await this._updateStats();

    // Update list
    this._updateReplayList();

    // Update insights
    await this._updateInsights();
  }

  async _updateStats() {
    const stats = await replayDatabase.getStats();
    const statsBar = document.getElementById("stats-bar");

    const winRate =
      stats.totalReplays > 0 ? Math.round(stats.winRate * 100) : 0;

    statsBar.innerHTML = `
      <div class="stat">
        <span class="stat-value">${stats.totalReplays}</span>
        <span class="stat-label">Replays</span>
      </div>
      <div class="stat">
        <span class="stat-value">${stats.byResult.win || 0}</span>
        <span class="stat-label">Wins (${winRate}%)</span>
      </div>
      <div class="stat">
        <span class="stat-value">${stats.totalDigests}</span>
        <span class="stat-label">Training Samples</span>
      </div>
      <div class="stat quality-stats">
        <span class="quality clean">${stats.byQuality.clean || 0} clean</span>
        <span class="quality partial">${
          stats.byQuality.partial || 0
        } partial</span>
        <span class="quality noisy">${stats.byQuality.noisy || 0} noisy</span>
      </div>
    `;
  }

  _updateReplayList() {
    const listItems = this.container.querySelector(".replay-list-items");

    if (this.replays.length === 0) {
      listItems.innerHTML = '<p class="placeholder">No replays found</p>';
      return;
    }

    listItems.innerHTML = this.replays
      .map(
        (r) => `
      <div class="replay-item ${
        this.selectedReplay?.id === r.id ? "selected" : ""
      }" 
           data-id="${r.id}">
        <div class="replay-item-main">
          <span class="replay-result ${r.result}">${
          r.result === "win" ? "W" : "L"
        }</span>
          <span class="replay-archetype">${r.archetype || "?"}</span>
          <span class="replay-turns">${r.totalTurns || "?"}T</span>
        </div>
        <div class="replay-item-meta">
          <span class="replay-matchup">vs ${r.botArchetype || "?"}</span>
          <span class="replay-quality ${r.quality}">${r.quality}</span>
        </div>
      </div>
    `
      )
      .join("");

    // Click handlers
    listItems.querySelectorAll(".replay-item").forEach((item) => {
      item.onclick = () => this._selectReplay(item.dataset.id);
    });
  }

  async _updateInsights() {
    const insightsContent = this.container.querySelector(".insights-content");
    const archetype = this.filters.archetype || "Luminarch";

    try {
      // Top cards
      const topCards = await replayInsights.getTopCardsByWinRate(
        { archetype, quality: "clean" },
        5
      );

      // Opening patterns
      const openings = await replayInsights.getOpeningPatterns(archetype);

      // Phase preferences
      const phases = await replayInsights.getPhasePreferences(archetype);

      insightsContent.innerHTML = `
        <div class="insight-section">
          <h4>Top Cards by Win Rate</h4>
          ${
            topCards.length === 0
              ? '<p class="placeholder">Insufficient data (need 3+ replays)</p>'
              : `
            ${
              topCards[0]?.sampleSize < 5
                ? '<p class="low-confidence-warning">⚠️ Low sample size - results may vary</p>'
                : ""
            }
            <ul class="top-cards-list">
              ${topCards
                .map(
                  (c, i) => `
                <li>
                  <span class="rank">#${i + 1}</span>
                  <span class="card-name">${c.cardName}</span>
                  <span class="win-rate">${Math.round(c.winRate * 100)}%</span>
                  <span class="sample-size">(n=${c.sampleSize})</span>
                </li>
              `
                )
                .join("")}
            </ul>
          `
          }
        </div>
        
        <div class="insight-section">
          <h4>Opening Patterns</h4>
          ${
            openings.length === 0
              ? '<p class="placeholder">Insufficient data (need 3+ replays)</p>'
              : `
            ${
              openings[0]?.sampleSize < 5
                ? '<p class="low-confidence-warning">⚠️ Low sample size - results may vary</p>'
                : ""
            }
            <ul class="openings-list">
              ${openings
                .slice(0, 3)
                .map(
                  (o) => `
                <li>
                  <span class="pattern">${o.pattern}</span>
                  <span class="win-rate">${Math.round(
                    o.winRate * 100
                  )}% WR</span>
                </li>
              `
                )
                .join("")}
            </ul>
          `
          }
        </div>
        
        <div class="insight-section">
          <h4>Phase Activity</h4>
          <div class="phase-bars">
            <div class="phase-bar">
              <span class="phase-name">Main1</span>
              <div class="bar">
                <div class="bar-fill" style="width: ${Math.min(
                  100,
                  phases.main1?.avgSummons * 30 || 0
                )}%"></div>
              </div>
              <span class="phase-value">${(
                phases.main1?.avgSummons || 0
              ).toFixed(1)} summons</span>
            </div>
            <div class="phase-bar">
              <span class="phase-name">Battle</span>
              <div class="bar">
                <div class="bar-fill" style="width: ${Math.min(
                  100,
                  phases.battle?.avgAttacks * 30 || 0
                )}%"></div>
              </div>
              <span class="phase-value">${(
                phases.battle?.avgAttacks || 0
              ).toFixed(1)} attacks</span>
            </div>
          </div>
        </div>
      `;
    } catch (e) {
      insightsContent.innerHTML = `<p class="error">Error loading insights: ${e.message}</p>`;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Replay Details
  // ─────────────────────────────────────────────────────────────────────────

  async _selectReplay(replayId) {
    const replay = await replayDatabase.getReplay(replayId);
    if (!replay) return;

    this.selectedReplay = replay;
    this._updateReplayList(); // Highlight selected

    const detailsContent = this.container.querySelector(".details-content");

    // Detect patterns
    const patterns = patternMatcher.detectPatterns(replay);

    detailsContent.innerHTML = `
      <div class="replay-detail-header">
        <h4>${replay.archetype || "Unknown"} vs ${
      replay.botArchetype || "Unknown"
    }</h4>
        <span class="result-badge ${
          replay.result
        }">${replay.result?.toUpperCase()}</span>
      </div>
      
      <div class="replay-detail-stats">
        <div class="stat-row">
          <span class="label">Turns:</span>
          <span class="value">${replay.totalTurns || "?"}</span>
        </div>
        <div class="stat-row">
          <span class="label">Decisions:</span>
          <span class="value">${replay.decisions?.length || 0}</span>
        </div>
        <div class="stat-row">
          <span class="label">Quality:</span>
          <span class="value quality ${replay.quality}">${replay.quality}</span>
        </div>
        ${
          replay.validationIssues?.length
            ? `
          <div class="stat-row issues">
            <span class="label">Issues:</span>
            <span class="value">${replay.validationIssues.join(", ")}</span>
          </div>
        `
            : ""
        }
      </div>
      
      <div class="replay-patterns">
        <h5>Detected Patterns (${patterns.length})</h5>
        ${
          patterns.length === 0
            ? '<p class="placeholder">No patterns detected</p>'
            : `
          <ul>
            ${patterns
              .slice(0, 5)
              .map(
                (p) => `
              <li>
                <span class="pattern-name">${p.patternName}</span>
                <span class="pattern-turn">T${p.turn}</span>
              </li>
            `
              )
              .join("")}
          </ul>
        `
        }
      </div>
      
      <div class="replay-actions">
        <button class="replay-btn small" onclick="window.replayDashboard._deleteReplay('${replayId}')">
          🗑️ Delete
        </button>
        <button class="replay-btn small" onclick="window.replayDashboard._downloadReplay('${replayId}')">
          📥 Download
        </button>
      </div>
    `;
  }

  async _deleteReplay(replayId) {
    if (!confirm("Delete this replay?")) return;

    await replayDatabase.deleteReplay(replayId);
    this.selectedReplay = null;
    await this.refresh();
  }

  async _downloadReplay(replayId) {
    const replay = await replayDatabase.getReplay(replayId);
    if (!replay) return;

    const blob = new Blob([JSON.stringify(replay, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${replayId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Import
  // ─────────────────────────────────────────────────────────────────────────

  _showImportModal() {
    const modal = document.createElement("div");
    modal.className = "replay-modal";
    modal.innerHTML = `
      <div class="replay-modal-backdrop"></div>
      <div class="replay-modal-content">
        <h3>Import Replays</h3>
        <div class="drop-zone" id="drop-zone">
          <p>📁 Drag & drop replay files here</p>
          <p class="hint">or click to select files</p>
          <input type="file" id="file-input" multiple accept=".json" style="display: none">
        </div>
        <div class="import-progress" id="import-progress" style="display: none">
          <div class="progress-bar"><div class="progress-fill"></div></div>
          <p class="progress-text"></p>
        </div>
        <div class="modal-actions">
          <button class="replay-btn" id="close-modal">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const dropZone = modal.querySelector("#drop-zone");
    const fileInput = modal.querySelector("#file-input");
    const backdrop = modal.querySelector(".replay-modal-backdrop");
    const closeBtn = modal.querySelector("#close-modal");

    // Close handlers
    const closeModal = () => modal.remove();
    backdrop.onclick = closeModal;
    closeBtn.onclick = closeModal;

    // Click to select
    dropZone.onclick = () => fileInput.click();

    // File selection
    fileInput.onchange = (e) => this._handleFiles(e.target.files, modal);

    // Drag & drop
    dropZone.ondragover = (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    };
    dropZone.ondragleave = () => dropZone.classList.remove("dragover");
    dropZone.ondrop = (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      this._handleFiles(e.dataTransfer.files, modal);
    };
  }

  async _handleFiles(files, modal) {
    const progress = modal.querySelector("#import-progress");
    const progressFill = progress.querySelector(".progress-fill");
    const progressText = progress.querySelector(".progress-text");

    progress.style.display = "block";
    progressText.textContent = `Importing ${files.length} files...`;

    const result = await replayImporter.importFiles(files);

    progressFill.style.width = "100%";
    progressText.innerHTML = `
      ✅ ${result.imported} imported<br>
      ⏭️ ${result.skipped} skipped (duplicates)<br>
      ❌ ${result.errors} errors
    `;

    // Refresh after short delay
    setTimeout(() => {
      this.refresh();
    }, 1000);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Export
  // ─────────────────────────────────────────────────────────────────────────

  async _exportJSONL() {
    const count = await replayDatabase.downloadDigestsJSONL(
      this.filters,
      `training_digest_${Date.now()}`
    );
    alert(`Exported ${count} training samples as JSONL`);
  }

  async _confirmClearAll() {
    if (
      !confirm(
        "⚠️ This will delete ALL replays and training data. Are you sure?"
      )
    )
      return;
    if (!confirm("This action cannot be undone. Continue?")) return;

    await replayDatabase.clearAll();
    this.selectedReplay = null;
    await this.refresh();
  }
}

// Singleton e exposição global para botões onclick
const replayDashboard = new ReplayDashboard();
window.replayDashboard = replayDashboard;

export { ReplayDashboard, replayDashboard };
export default replayDashboard;
