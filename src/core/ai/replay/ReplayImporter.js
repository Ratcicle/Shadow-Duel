// ═══════════════════════════════════════════════════════════════════════════
// ReplayImporter.js - Importação, validação e deduplicação de replays
// Sanity checks, versioning e marcação de qualidade
// ═══════════════════════════════════════════════════════════════════════════

import { replayDatabase } from "./ReplayDatabase.js";
import { ReplayAnalyzer } from "./ReplayAnalyzer.js";

// Configuração de validação
const MIN_SUPPORTED_VERSION = 2;
const CURRENT_VERSION = 3;

/**
 * ReplayImporter - Importação em massa de arquivos de replay
 *
 * Features:
 *   - Validação de schema e versão
 *   - Sanity checks (turnos monotônicos, LPs coerentes, eventos essenciais)
 *   - Deduplicação por hash de conteúdo
 *   - Marcação de qualidade (clean, partial, noisy)
 *   - Geração automática de training digests
 */
class ReplayImporter {
  constructor(database = replayDatabase) {
    this.db = database;
    this.analyzer = new ReplayAnalyzer();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Importação
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Importa múltiplos arquivos de replay
   * @param {FileList|Array<File>} files - Arquivos .json
   * @param {Object} options - { skipDuplicates: true, analyzeDigests: true }
   * @returns {Promise<Object>} Resultado da importação
   */
  async importFiles(files, options = {}) {
    const { skipDuplicates = true, analyzeDigests = true } = options;

    const result = {
      imported: 0,
      skipped: 0,
      errors: 0,
      details: [],
    };

    for (const file of files) {
      try {
        const importResult = await this.importFile(file, {
          skipDuplicates,
          analyzeDigests,
        });

        if (importResult.status === "imported") {
          result.imported++;
        } else if (importResult.status === "skipped") {
          result.skipped++;
        }

        result.details.push(importResult);
      } catch (error) {
        result.errors++;
        result.details.push({
          file: file.name,
          status: "error",
          error: error.message,
        });
      }
    }

    console.log(
      `[ReplayImporter] Importação concluída: ${result.imported} importados, ${result.skipped} pulados, ${result.errors} erros`
    );
    return result;
  }

  /**
   * Importa um único arquivo de replay
   * @param {File} file
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async importFile(file, options = {}) {
    const { skipDuplicates = true, analyzeDigests = true } = options;

    // Ler conteúdo
    const content = await this._readFile(file);
    let replay;

    try {
      replay = JSON.parse(content);
    } catch (e) {
      throw new Error(`JSON inválido: ${e.message}`);
    }

    // Gerar hash para deduplicação
    const contentHash = await this._hashContent(content);

    // Verificar duplicata
    if (skipDuplicates) {
      const exists = await this.db.existsByHash(contentHash);
      if (exists) {
        return {
          file: file.name,
          status: "skipped",
          reason: "duplicate",
          replayId: null,
        };
      }
    }

    // Validar replay
    const validation = this.validateReplay(replay);

    // Preparar replay para armazenamento
    const processedReplay = this._prepareReplay(
      replay,
      contentHash,
      validation
    );

    // Salvar replay
    await this.db.saveReplay(processedReplay);

    // Gerar e salvar training digests
    let digestCount = 0;
    if (analyzeDigests && validation.quality !== "noisy") {
      const digests = this.analyzer.generateTrainingDigests(processedReplay);
      digestCount = await this.db.saveDigests(digests);
    }

    return {
      file: file.name,
      status: "imported",
      replayId: processedReplay.id,
      quality: validation.quality,
      issues: validation.issues,
      digestsGenerated: digestCount,
    };
  }

  /**
   * Importa replay a partir de objeto (não arquivo)
   * @param {Object} replay - Objeto de replay já parseado
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async importReplayObject(replay, options = {}) {
    const { skipDuplicates = true, analyzeDigests = true } = options;

    const content = JSON.stringify(replay);
    const contentHash = await this._hashContent(content);

    // Verificar duplicata
    if (skipDuplicates) {
      const exists = await this.db.existsByHash(contentHash);
      if (exists) {
        return { status: "skipped", reason: "duplicate" };
      }
    }

    const validation = this.validateReplay(replay);
    const processedReplay = this._prepareReplay(
      replay,
      contentHash,
      validation
    );

    await this.db.saveReplay(processedReplay);

    let digestCount = 0;
    if (analyzeDigests && validation.quality !== "noisy") {
      const digests = this.analyzer.generateTrainingDigests(processedReplay);
      digestCount = await this.db.saveDigests(digests);
    }

    return {
      status: "imported",
      replayId: processedReplay.id,
      quality: validation.quality,
      issues: validation.issues,
      digestsGenerated: digestCount,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Validação
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Valida integridade e qualidade de um replay
   * @param {Object} replay
   * @returns {Object} { quality: "clean"|"partial"|"noisy", issues: string[] }
   */
  validateReplay(replay) {
    const issues = [];

    // ── Schema / Version ──
    if (!replay.version) {
      issues.push("missing_version");
    } else if (replay.version < MIN_SUPPORTED_VERSION) {
      issues.push("version_outdated");
    }

    if (!replay.id) {
      issues.push("missing_id");
    }

    if (!replay.decisions || !Array.isArray(replay.decisions)) {
      issues.push("missing_decisions");
    } else if (replay.decisions.length === 0) {
      issues.push("no_decisions");
    }

    if (!replay.result) {
      issues.push("missing_result");
    } else if (!replay.result.winner && !replay.result?.winner?.winner) {
      issues.push("incomplete_result");
    }

    // ── Estado inicial zerado ──
    // Turno 0 com LP=0 é esperado (estado antes do primeiro draw)
    // Apenas verificar snapshots de turnos reais (turn > 0)
    const firstRealSnapshot = Object.entries(replay.snapshots || {})
      .filter(([turn]) => parseInt(turn) > 0)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))[0];

    if (firstRealSnapshot) {
      const [, snap] = firstRealSnapshot;
      if (snap.playerLP === 0 && snap.botLP === 0) {
        issues.push("zeroed_game_state");
      }
    }

    // ── Turnos monotônicos ──
    if (replay.decisions?.length) {
      let lastTurn = 0;
      let turnRegression = false;

      for (const d of replay.decisions) {
        if (d.turn !== undefined && d.turn < lastTurn) {
          turnRegression = true;
          break;
        }
        if (d.turn !== undefined) {
          lastTurn = d.turn;
        }
      }

      if (turnRegression) {
        issues.push("turn_regression");
      }
    }

    // ── Fases válidas ──
    const validPhases = new Set([
      "main1",
      "battle",
      "main2",
      "end",
      "standby",
      "draw",
      "unknown",
    ]);
    if (replay.decisions?.length) {
      for (const d of replay.decisions) {
        if (d.phase && !validPhases.has(d.phase)) {
          issues.push("invalid_phase");
          break;
        }
      }
    }

    // ── Eventos essenciais ──
    if (replay.decisions?.length) {
      const types = new Set(replay.decisions.map((d) => d.type));

      // Todo replay deveria ter pelo menos summon ou pass
      if (!types.has("summon") && !types.has("pass") && !types.has("attack")) {
        issues.push("missing_essential_events");
      }
    }

    // ── Deck info ──
    // Aceitar ambos schemas: playerDeck.playerDeck (aninhado) ou playerDeck como array direto
    const hasDeck =
      replay.playerDeck &&
      (Array.isArray(replay.playerDeck.playerDeck) ||
        Array.isArray(replay.playerDeck));
    if (!hasDeck) {
      issues.push("missing_player_deck");
    }

    // ── Calcular qualidade ──
    let quality;
    const criticalIssues = [
      "missing_decisions",
      "no_decisions",
      "missing_result",
      "zeroed_game_state",
    ];
    const hasCritical = issues.some((i) => criticalIssues.includes(i));

    if (hasCritical) {
      quality = "noisy";
    } else if (issues.length === 0) {
      quality = "clean";
    } else if (issues.length <= 2) {
      quality = "partial";
    } else {
      quality = "noisy";
    }

    return { quality, issues };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Prepara replay para armazenamento com metadados adicionais
   */
  _prepareReplay(replay, contentHash, validation) {
    // Extrair archetype do jogador
    let archetype = "unknown";
    if (typeof replay.playerDeck === "string") {
      archetype = replay.playerDeck;
    } else if (replay.playerDeck?.playerDeck) {
      // Detectar archetype pelos nomes das cartas
      const firstCard = replay.playerDeck.playerDeck[0];
      if (typeof firstCard === "string") {
        if (firstCard.includes("Luminarch")) archetype = "Luminarch";
        else if (firstCard.includes("Shadow-Heart")) archetype = "Shadow-Heart";
        else if (firstCard.includes("Dragon")) archetype = "Dragon";
        else if (firstCard.includes("Void")) archetype = "Void";
      }
    }

    // Extrair matchup
    const opponent = replay.botArchetype || replay.botDeck || "unknown";
    const matchup = `${archetype}_vs_${opponent}`;

    // Extrair resultado
    let result = "unknown";
    if (
      replay.result?.winner === "player" ||
      replay.result?.winner === "human"
    ) {
      result = "win";
    } else if (replay.result?.winner?.winner === "human") {
      result = "win";
    } else if (
      replay.result?.winner === "bot" ||
      replay.result?.winner?.winner === "bot"
    ) {
      result = "loss";
    }

    return {
      ...replay,
      contentHash,
      archetype,
      matchup,
      result,
      quality: validation.quality,
      validationIssues: validation.issues,
      importedAt: new Date().toISOString(),
    };
  }

  /**
   * Lê conteúdo de um File
   */
  _readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  /**
   * Gera hash SHA-256 do conteúdo para deduplicação
   */
  async _hashContent(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utilidades
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Valida um arquivo sem importar
   * @param {File} file
   * @returns {Promise<Object>}
   */
  async validateFile(file) {
    const content = await this._readFile(file);
    let replay;

    try {
      replay = JSON.parse(content);
    } catch (e) {
      return { valid: false, error: `JSON inválido: ${e.message}` };
    }

    const validation = this.validateReplay(replay);

    return {
      valid: validation.quality !== "noisy",
      version: replay.version,
      ...validation,
    };
  }

  /**
   * Importa todos os replays de um input file element
   * @param {HTMLInputElement} inputElement
   * @returns {Promise<Object>}
   */
  async importFromInput(inputElement) {
    if (!inputElement.files?.length) {
      return { imported: 0, skipped: 0, errors: 0, details: [] };
    }

    return this.importFiles(inputElement.files);
  }
}

// Singleton
const replayImporter = new ReplayImporter();

export { ReplayImporter, replayImporter };
export default replayImporter;
