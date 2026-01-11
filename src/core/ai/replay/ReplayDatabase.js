// ═══════════════════════════════════════════════════════════════════════════
// ReplayDatabase.js - Armazenamento persistente de replays usando IndexedDB
// Stores: replays, digests, aggregates
// ═══════════════════════════════════════════════════════════════════════════

const DB_NAME = "ShadowDuelReplays";
const DB_VERSION = 1;

/**
 * ReplayDatabase - Persistência IndexedDB para replays e training digests
 *
 * Stores:
 *   - replays: raw replay data com metadados e quality rating
 *   - digests: training digest entries (decisões individuais)
 *   - aggregates: métricas agregadas pré-calculadas (cache)
 */
class ReplayDatabase {
  constructor() {
    this.db = null;
    this._initPromise = null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Inicialização
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Inicializa conexão com IndexedDB
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (this.db) return this.db;
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error(
          "[ReplayDatabase] Erro ao abrir IndexedDB:",
          request.error
        );
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log(`[ReplayDatabase] Conectado (v${DB_VERSION})`);
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        this._createStores(db);
      };
    });

    return this._initPromise;
  }

  /**
   * Cria object stores na primeira inicialização ou upgrade
   */
  _createStores(db) {
    // Store: replays
    if (!db.objectStoreNames.contains("replays")) {
      const replaysStore = db.createObjectStore("replays", { keyPath: "id" });
      replaysStore.createIndex("archetype", "archetype", { unique: false });
      replaysStore.createIndex("matchup", "matchup", { unique: false });
      replaysStore.createIndex("result", "result", { unique: false });
      replaysStore.createIndex("quality", "quality", { unique: false });
      replaysStore.createIndex("timestamp", "timestamp", { unique: false });
      replaysStore.createIndex("contentHash", "contentHash", { unique: true });
    }

    // Store: digests (training entries individuais)
    if (!db.objectStoreNames.contains("digests")) {
      const digestsStore = db.createObjectStore("digests", {
        keyPath: "id",
        autoIncrement: true,
      });
      digestsStore.createIndex("replayId", "replayId", { unique: false });
      digestsStore.createIndex("archetype", "archetype", { unique: false });
      digestsStore.createIndex("matchup", "matchup", { unique: false });
      digestsStore.createIndex("promptType", "promptType", { unique: false });
      digestsStore.createIndex("turn", "turn", { unique: false });
      digestsStore.createIndex("actor", "actor", { unique: false });
    }

    // Store: aggregates (cache de métricas)
    if (!db.objectStoreNames.contains("aggregates")) {
      const aggregatesStore = db.createObjectStore("aggregates", {
        keyPath: "key",
      });
      aggregatesStore.createIndex("dirty", "dirty", { unique: false });
    }

    console.log("[ReplayDatabase] Stores criados");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD - Replays
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Salva um replay processado
   * @param {Object} replayData - Replay com metadados adicionais
   * @returns {Promise<string>} ID do replay
   */
  async saveReplay(replayData) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("replays", "readwrite");
      const store = tx.objectStore("replays");
      const request = store.put(replayData);

      request.onsuccess = () => {
        this._markAggregatesDirty();
        resolve(replayData.id);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Busca replay por ID
   * @param {string} replayId
   * @returns {Promise<Object|null>}
   */
  async getReplay(replayId) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("replays", "readonly");
      const store = tx.objectStore("replays");
      const request = store.get(replayId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Verifica se replay já existe por hash de conteúdo
   * @param {string} contentHash
   * @returns {Promise<boolean>}
   */
  async existsByHash(contentHash) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("replays", "readonly");
      const store = tx.objectStore("replays");
      const index = store.index("contentHash");
      const request = index.get(contentHash);

      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Remove replay por ID
   * @param {string} replayId
   * @returns {Promise<void>}
   */
  async deleteReplay(replayId) {
    await this.init();

    // Remove replay e seus digests
    const tx = this.db.transaction(["replays", "digests"], "readwrite");

    // Remove replay
    tx.objectStore("replays").delete(replayId);

    // Remove digests relacionados
    const digestStore = tx.objectStore("digests");
    const index = digestStore.index("replayId");
    const request = index.openCursor(IDBKeyRange.only(replayId));

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        this._markAggregatesDirty();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Lista todos os replays com filtros opcionais
   * @param {Object} filters - { archetype, matchup, result, quality }
   * @returns {Promise<Array>}
   */
  async listReplays(filters = {}) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("replays", "readonly");
      const store = tx.objectStore("replays");
      const results = [];

      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const replay = cursor.value;

          // Aplicar filtros
          let match = true;
          if (filters.archetype && replay.archetype !== filters.archetype)
            match = false;
          if (filters.matchup && replay.matchup !== filters.matchup)
            match = false;
          if (filters.result && replay.result !== filters.result) match = false;
          if (filters.quality && replay.quality !== filters.quality)
            match = false;

          if (match) {
            results.push(replay);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Conta replays por filtro
   * @param {Object} filters
   * @returns {Promise<number>}
   */
  async countReplays(filters = {}) {
    const replays = await this.listReplays(filters);
    return replays.length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRUD - Training Digests
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Salva batch de training digests
   * @param {Array} digests - Array de digest entries
   * @returns {Promise<number>} Quantidade salva
   */
  async saveDigests(digests) {
    if (!digests?.length) return 0;
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("digests", "readwrite");
      const store = tx.objectStore("digests");

      let count = 0;
      for (const digest of digests) {
        const request = store.add(digest);
        request.onsuccess = () => count++;
      }

      tx.oncomplete = () => {
        this._markAggregatesDirty();
        resolve(count);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Busca digests por filtros
   * @param {Object} filters - { replayId, archetype, matchup, promptType, actor }
   * @param {Object} options - { limit, offset }
   * @returns {Promise<Array>}
   */
  async queryDigests(filters = {}, options = {}) {
    await this.init();

    const { limit = 1000, offset = 0 } = options;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("digests", "readonly");
      const store = tx.objectStore("digests");
      const results = [];
      let skipped = 0;

      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && results.length < limit) {
          const digest = cursor.value;

          // Aplicar filtros
          let match = true;
          if (filters.replayId && digest.replayId !== filters.replayId)
            match = false;
          if (filters.archetype && digest.archetype !== filters.archetype)
            match = false;
          if (filters.matchup && digest.matchup !== filters.matchup)
            match = false;
          if (filters.promptType && digest.promptType !== filters.promptType)
            match = false;
          if (filters.actor && digest.actor !== filters.actor) match = false;

          if (match) {
            if (skipped >= offset) {
              results.push(digest);
            } else {
              skipped++;
            }
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Conta digests por filtro
   * @param {Object} filters
   * @returns {Promise<number>}
   */
  async countDigests(filters = {}) {
    const digests = await this.queryDigests(filters, { limit: 100000 });
    return digests.length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Aggregates (Cache)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Salva aggregate pré-calculado
   * @param {string} key - Ex: "luminarch_vs_shadowheart|wins|clean"
   * @param {Object} value - Métricas agregadas
   */
  async saveAggregate(key, value) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("aggregates", "readwrite");
      const store = tx.objectStore("aggregates");

      const aggregate = {
        key,
        value,
        computedAt: Date.now(),
        dirty: false,
      };

      const request = store.put(aggregate);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Busca aggregate por key
   * @param {string} key
   * @returns {Promise<Object|null>}
   */
  async getAggregate(key) {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("aggregates", "readonly");
      const store = tx.objectStore("aggregates");
      const request = store.get(key);

      request.onsuccess = () => {
        const result = request.result;
        if (result && !result.dirty) {
          resolve(result.value);
        } else {
          resolve(null); // dirty ou não existe
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Marca todos aggregates como dirty (precisa recalcular)
   */
  async _markAggregatesDirty() {
    if (!this.db) return;

    const tx = this.db.transaction("aggregates", "readwrite");
    const store = tx.objectStore("aggregates");

    const request = store.openCursor();
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const aggregate = cursor.value;
        aggregate.dirty = true;
        cursor.update(aggregate);
        cursor.continue();
      }
    };
  }

  /**
   * Limpa todos aggregates
   */
  async clearAggregates() {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("aggregates", "readwrite");
      const store = tx.objectStore("aggregates");
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Exportação
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Exporta digests como JSONL (uma linha por decisão)
   * @param {Object} filters - { archetype, matchup, result, quality, actor }
   * @returns {Promise<string>} Conteúdo JSONL
   */
  async exportDigestsAsJSONL(filters = {}) {
    const digests = await this.queryDigests(filters, { limit: 100000 });

    const lines = digests.map((d) => JSON.stringify(d));
    return lines.join("\n");
  }

  /**
   * Exporta digests como JSONL e faz download
   * @param {Object} filters
   * @param {string} filename
   */
  async downloadDigestsJSONL(filters = {}, filename = "training_digest") {
    const content = await this.exportDigestsAsJSONL(filters);
    const count = content.split("\n").length;

    // Criar metadata
    const metadata = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      filters,
      totalRows: count,
      features: [
        "turn",
        "phase",
        "actor",
        "promptType",
        "chosenAction",
        "availableActions",
        "context",
        "outcome",
      ],
    };

    // Download JSONL
    const blob = new Blob([content], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);

    // Download metadata
    const metaBlob = new Blob([JSON.stringify(metadata, null, 2)], {
      type: "application/json",
    });
    const metaUrl = URL.createObjectURL(metaBlob);
    const metaA = document.createElement("a");
    metaA.href = metaUrl;
    metaA.download = `${filename}_metadata.json`;
    metaA.click();
    URL.revokeObjectURL(metaUrl);

    console.log(`[ReplayDatabase] Exportado: ${count} digests`);
    return count;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Estatísticas rápidas
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Retorna estatísticas gerais do banco
   * @returns {Promise<Object>}
   */
  async getStats() {
    await this.init();

    const replays = await this.listReplays();
    const digestCount = await this.countDigests();

    const byQuality = { clean: 0, partial: 0, noisy: 0 };
    const byResult = { win: 0, loss: 0 };
    const archetypes = new Set();

    for (const r of replays) {
      byQuality[r.quality] = (byQuality[r.quality] || 0) + 1;
      byResult[r.result] = (byResult[r.result] || 0) + 1;
      if (r.archetype) archetypes.add(r.archetype);
    }

    return {
      totalReplays: replays.length,
      totalDigests: digestCount,
      byQuality,
      byResult,
      archetypes: Array.from(archetypes),
      winRate: replays.length > 0 ? byResult.win / replays.length : 0,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Manutenção
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Limpa todo o banco de dados
   */
  async clearAll() {
    await this.init();

    const tx = this.db.transaction(
      ["replays", "digests", "aggregates"],
      "readwrite"
    );
    tx.objectStore("replays").clear();
    tx.objectStore("digests").clear();
    tx.objectStore("aggregates").clear();

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        console.log("[ReplayDatabase] Banco limpo");
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Fecha conexão com o banco
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this._initPromise = null;
    }
  }
}

// Singleton para uso global
const replayDatabase = new ReplayDatabase();

export { ReplayDatabase, replayDatabase };
export default replayDatabase;
