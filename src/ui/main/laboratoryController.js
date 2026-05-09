import { cardDatabase, cardDatabaseById } from "../../data/cards.js";
import {
  MAX_EXTRA_DECK_SIZE,
  cardHasArchetypeName,
  getSortedCardPool,
} from "./deckState.js";

const LAB_ZONE_CONFIG = [
  { id: "deck", label: "Deck", max: null, defaultCount: 20 },
  { id: "extraDeck", label: "Extra Deck", max: MAX_EXTRA_DECK_SIZE, defaultCount: 5 },
  { id: "hand", label: "Mão", max: null, defaultCount: 4 },
  { id: "field", label: "Campo", max: 5, defaultCount: 2 },
  { id: "spellTrap", label: "Magias/Armadilhas", max: 5, defaultCount: 1 },
  { id: "fieldSpell", label: "Campo Mágico", max: 1, defaultCount: 1 },
  { id: "graveyard", label: "Cemitério", max: null, defaultCount: 2 },
];

const LAB_ZONE_LABELS = Object.fromEntries(
  LAB_ZONE_CONFIG.map((zone) => [zone.id, zone.label]),
);

const LAB_OWNER_LABELS = {
  player: "Jogador 1",
  bot: "Jogador 2",
};

export function createLaboratoryController({
  dom,
  startScreenRoot,
  getCardDisplayName,
}) {
  let laboratorySetup = createEmptyLaboratorySetup();
  let laboratorySelection = { owner: "player", zone: "hand" };
  let laboratoryMode = "test";

  function createEmptyLaboratorySide() {
    return {
      lp: 8000,
      deck: [],
      extraDeck: [],
      hand: [],
      field: [],
      spellTrap: [],
      fieldSpell: [],
      graveyard: [],
    };
  }

  function createEmptyLaboratorySetup() {
    return {
      player: createEmptyLaboratorySide(),
      bot: createEmptyLaboratorySide(),
    };
  }

  function cloneLabEntry(entry) {
    return entry && typeof entry === "object" ? { ...entry } : null;
  }

  function getLabZone(owner, zone) {
    const side = laboratorySetup?.[owner];
    const value = side?.[zone];
    return Array.isArray(value) ? value : [];
  }

  function getLabZoneConfig(zone) {
    return LAB_ZONE_CONFIG.find((item) => item.id === zone) || LAB_ZONE_CONFIG[0];
  }

  function getLabCard(entry) {
    const id = typeof entry === "number" ? entry : entry?.id;
    return cardDatabaseById.get(id) || null;
  }

  function resolveLabCardData(entry) {
    if (typeof entry === "number") return cardDatabaseById.get(entry) || null;
    if (typeof entry === "string") {
      const lower = entry.trim().toLowerCase();
      return (
        cardDatabase.find(
          (card) =>
            card.name.toLowerCase() === lower ||
            (getCardDisplayName(card) || "").toLowerCase() === lower,
        ) || null
      );
    }
    if (!entry || typeof entry !== "object") return null;
    if (typeof entry.id === "number") {
      return cardDatabaseById.get(entry.id) || null;
    }
    if (entry.name) return resolveLabCardData(entry.name);
    return null;
  }

  function cardMatchesLabArchetype(card, archetype) {
    if (!archetype || archetype === "all") return true;
    return cardHasArchetypeName(card, archetype);
  }

  function getLabCandidates(zone, archetype = "all") {
    return cardDatabase.filter((card) => {
      if (!cardMatchesLabArchetype(card, archetype)) return false;
      if (zone === "extraDeck") {
        return card.monsterType === "fusion" || card.monsterType === "ascension";
      }
      if (zone === "field") return card.cardKind === "monster";
      if (zone === "spellTrap") {
        return (
          (card.cardKind === "spell" || card.cardKind === "trap") &&
          card.subtype !== "field"
        );
      }
      if (zone === "fieldSpell") {
        return card.cardKind === "spell" && card.subtype === "field";
      }
      if (zone === "deck" || zone === "hand") {
        return card.monsterType !== "fusion" && card.monsterType !== "ascension";
      }
      return true;
    });
  }

  function getLabEntryForCard(card, zone) {
    const entry = { id: card.id };
    if (zone === "field") {
      entry.position = dom.positionSelect?.value || "attack";
      entry.facedown = !!dom.facedownInput?.checked;
    } else if (zone === "spellTrap") {
      entry.facedown = !!dom.facedownInput?.checked;
    }
    return entry;
  }

  function applyZoneSelection(owner, zone) {
    laboratorySelection = { owner, zone };
    if (dom.addOwnerSelect) dom.addOwnerSelect.value = owner;
    if (dom.addZoneSelect) dom.addZoneSelect.value = zone;
    updateAddControls();
    render();
  }

  function updateAddControls() {
    const zone = dom.addZoneSelect?.value || laboratorySelection.zone;
    const needsPosition = zone === "field";
    const canFacedown = zone === "field" || zone === "spellTrap";
    if (dom.positionSelect) {
      dom.positionSelect.disabled = !needsPosition;
    }
    if (dom.facedownInput) {
      dom.facedownInput.disabled = !canFacedown;
      if (!canFacedown) dom.facedownInput.checked = false;
      if (zone === "spellTrap" && !dom.facedownInput.dataset.touched) {
        dom.facedownInput.checked = true;
      }
    }
  }

  function populateControls() {
    if (dom.addZoneSelect) {
      dom.addZoneSelect.innerHTML = "";
      LAB_ZONE_CONFIG.forEach((zone) => {
        const option = document.createElement("option");
        option.value = zone.id;
        option.textContent = zone.label;
        dom.addZoneSelect.appendChild(option);
      });
    }

    if (dom.archetypeSelect) {
      const archetypes = new Set(["all"]);
      cardDatabase.forEach((card) => {
        const list = Array.isArray(card.archetypes)
          ? card.archetypes
          : card.archetype
            ? [card.archetype]
            : [];
        list.forEach((name) => archetypes.add(name));
      });
      dom.archetypeSelect.innerHTML = "";
      [...archetypes].forEach((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name === "all" ? "Todos" : name;
        dom.archetypeSelect.appendChild(option);
      });
    }

    if (dom.cardOptions) {
      dom.cardOptions.innerHTML = "";
      getSortedCardPool(cardDatabase).forEach((card) => {
        const option = document.createElement("option");
        option.value = getCardDisplayName(card) || card.name;
        option.dataset.cardId = String(card.id);
        dom.cardOptions.appendChild(option);
      });
    }
  }

  function render() {
    if (!dom.body) return;
    dom.body.innerHTML = "";
    ["player", "bot"].forEach((owner) => {
      const side = laboratorySetup[owner];
      const panel = document.createElement("section");
      panel.className = "laboratory-side";
      panel.dataset.owner = owner;

      const header = document.createElement("div");
      header.className = "laboratory-side-header";
      header.innerHTML = `
        <h3>${LAB_OWNER_LABELS[owner]}</h3>
        <label class="laboratory-lp">LP
          <input type="number" min="0" max="99999" value="${side.lp}" data-lab-lp="${owner}" />
        </label>
        <button type="button" data-lab-random-side="${owner}">Aleatorizar lado</button>
      `;
      panel.appendChild(header);

      const zones = document.createElement("div");
      zones.className = "laboratory-zones";
      LAB_ZONE_CONFIG.forEach((zoneConfig) => {
        const zone = document.createElement("div");
        const isSelected =
          laboratorySelection.owner === owner &&
          laboratorySelection.zone === zoneConfig.id;
        zone.className = `laboratory-zone${isSelected ? " selected" : ""}`;
        zone.dataset.owner = owner;
        zone.dataset.zone = zoneConfig.id;

        const entries = getLabZone(owner, zoneConfig.id);
        const maxText = zoneConfig.max ? ` / ${zoneConfig.max}` : "";
        const headerEl = document.createElement("div");
        headerEl.className = "laboratory-zone-header";
        headerEl.innerHTML = `
          <span>${zoneConfig.label} (${entries.length}${maxText})</span>
          <button type="button" data-lab-random-zone="${owner}:${zoneConfig.id}">Sortear</button>
        `;
        zone.appendChild(headerEl);

        const list = document.createElement("div");
        list.className = "laboratory-card-list";
        if (entries.length === 0) {
          const empty = document.createElement("span");
          empty.className = "laboratory-empty";
          empty.textContent = "Vazio";
          list.appendChild(empty);
        } else {
          entries.forEach((entry, index) => {
            const card = getLabCard(entry);
            const chip = document.createElement("div");
            chip.className = "laboratory-card-chip";
            const meta = [];
            if (entry.position) meta.push(entry.position === "defense" ? "DEF" : "ATK");
            if (entry.facedown) meta.push("baixada");
            chip.innerHTML = `
              <span title="${card?.name || "Carta desconhecida"}">${card?.name || "Carta desconhecida"}${
                meta.length ? ` (${meta.join(", ")})` : ""
              }</span>
              <button type="button" data-lab-remove="${owner}:${zoneConfig.id}:${index}">&times;</button>
            `;
            list.appendChild(chip);
          });
        }
        zone.appendChild(list);
        zones.appendChild(zone);
      });
      panel.appendChild(zones);
      dom.body.appendChild(panel);
    });
  }

  function addCardToZone(owner, zone, entry) {
    const zoneConfig = getLabZoneConfig(zone);
    const entries = getLabZone(owner, zone);
    if (zoneConfig.max && entries.length >= zoneConfig.max) {
      alert(`${zoneConfig.label} atingiu o limite de ${zoneConfig.max}.`);
      return false;
    }
    const card = getLabCard(entry);
    if (!card || getLabCandidates(zone, "all").every((candidate) => candidate.id !== card.id)) {
      alert("Esta carta não é válida para a zona selecionada.");
      return false;
    }
    entries.push(cloneLabEntry(entry));
    return true;
  }

  function addSelectedCard() {
    const owner = dom.addOwnerSelect?.value || laboratorySelection.owner;
    const zone = dom.addZoneSelect?.value || laboratorySelection.zone;
    const rawName = dom.cardSearchInput?.value?.trim();
    if (!rawName) {
      alert("Escolha uma carta para adicionar.");
      return;
    }
    const lower = rawName.toLowerCase();
    const card = cardDatabase.find(
      (item) =>
        item.name.toLowerCase() === lower ||
        (getCardDisplayName(item) || "").toLowerCase() === lower,
    );
    if (!card) {
      alert("Carta não encontrada.");
      return;
    }
    if (addCardToZone(owner, zone, getLabEntryForCard(card, zone))) {
      if (dom.cardSearchInput) dom.cardSearchInput.value = "";
      laboratorySelection = { owner, zone };
      render();
    }
  }

  function randomizeZone(owner, zone) {
    const side = laboratorySetup[owner];
    const zoneConfig = getLabZoneConfig(zone);
    const current = getLabZone(owner, zone);
    const max = zoneConfig.max || Number.POSITIVE_INFINITY;
    const count = Math.min(
      current.length > 0 ? current.length : zoneConfig.defaultCount,
      max,
    );
    const archetype = dom.archetypeSelect?.value || "all";
    const candidates = getLabCandidates(zone, archetype);
    if (candidates.length === 0) {
      side[zone] = [];
      return;
    }
    side[zone] = Array.from({ length: count }, () => {
      const card = candidates[Math.floor(Math.random() * candidates.length)];
      if (zone === "field") {
        return {
          id: card.id,
          position: Math.random() > 0.5 ? "attack" : "defense",
          facedown: false,
        };
      }
      if (zone === "spellTrap") {
        return { id: card.id, facedown: Math.random() > 0.5 };
      }
      return { id: card.id };
    });
  }

  function randomizeSide(owner) {
    LAB_ZONE_CONFIG.forEach((zone) => randomizeZone(owner, zone.id));
    render();
  }

  function randomizeAll() {
    randomizeSide("player");
    randomizeSide("bot");
  }

  function buildSetupForGame() {
    const cloneSide = (side) => ({
      lp: Math.max(0, Math.floor(Number(side.lp) || 0)),
      deck: side.deck.map(cloneLabEntry).filter(Boolean),
      extraDeck: side.extraDeck.map(cloneLabEntry).filter(Boolean),
      hand: side.hand.map(cloneLabEntry).filter(Boolean),
      field: side.field.map(cloneLabEntry).filter(Boolean),
      spellTrap: side.spellTrap.map(cloneLabEntry).filter(Boolean),
      fieldSpell: side.fieldSpell.map(cloneLabEntry).filter(Boolean)[0] || null,
      graveyard: side.graveyard.map(cloneLabEntry).filter(Boolean),
    });
    return {
      player: cloneSide(laboratorySetup.player),
      bot: cloneSide(laboratorySetup.bot),
    };
  }

  function getDeckIds(owner, zone) {
    return getLabZone(owner, zone)
      .map((entry) => getLabCard(entry)?.id)
      .filter((id) => typeof id === "number");
  }

  function buildDuelDecks() {
    return {
      playerDeck: getDeckIds("player", "deck"),
      playerExtraDeck: getDeckIds("player", "extraDeck"),
      botDeck: getDeckIds("bot", "deck"),
      botExtraDeck: getDeckIds("bot", "extraDeck"),
    };
  }

  function setMode(mode) {
    laboratoryMode = mode === "duel" ? "duel" : "test";
    dom.modeButtons.forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.laboratoryMode === laboratoryMode,
      );
    });
  }

  function normalizeEntryForExport(entry, zone) {
    const card = getLabCard(entry);
    if (!card) return null;
    const out = { id: card.id };
    if (zone === "field") {
      out.position = entry.position === "defense" ? "defense" : "attack";
      out.facedown = entry.facedown === true;
    } else if (zone === "spellTrap" || zone === "fieldSpell") {
      out.facedown = entry.facedown === true;
    }
    return out;
  }

  function buildExportPayload() {
    const exportSide = (side) => {
      const result = {
        lp: Math.max(0, Math.floor(Number(side.lp) || 0)),
      };
      LAB_ZONE_CONFIG.forEach((zoneConfig) => {
        const zone = zoneConfig.id;
        const entries = Array.isArray(side[zone]) ? side[zone] : [];
        const exported = entries
          .map((entry) => normalizeEntryForExport(entry, zone))
          .filter(Boolean);
        result[zone] = zone === "fieldSpell" ? exported[0] || null : exported;
      });
      return result;
    };

    const options = {
      laboratoryMode,
      useBot: dom.useBotInput?.checked === true,
      revealBotHand: dom.revealBotHandInput?.checked === true,
      botPreset: dom.botArchetypeSelect?.value || "shadowheart",
    };

    return {
      version: 1,
      type: "shadow-duel-laboratory-state",
      exportedAt: new Date().toISOString(),
      laboratoryMode: options.laboratoryMode,
      useBot: options.useBot,
      revealBotHand: options.revealBotHand,
      botPreset: options.botPreset,
      options,
      setup: {
        player: exportSide(laboratorySetup.player),
        bot: exportSide(laboratorySetup.bot),
      },
    };
  }

  function downloadState() {
    const payload = buildExportPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    link.href = url;
    link.download = `shadow-duel-laboratory-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function normalizeImportedEntry(entry, zone, warnings) {
    const card = resolveLabCardData(entry);
    if (!card) {
      warnings.push(`Carta inválida ignorada em ${LAB_ZONE_LABELS[zone]}.`);
      return null;
    }
    const validForZone = getLabCandidates(zone, "all").some(
      (candidate) => candidate.id === card.id,
    );
    if (!validForZone) {
      warnings.push(`${card.name} não é válido para ${LAB_ZONE_LABELS[zone]}.`);
      return null;
    }
    const normalized = { id: card.id };
    if (zone === "field") {
      normalized.position = entry?.position === "defense" ? "defense" : "attack";
      normalized.facedown = entry?.facedown === true;
    } else if (zone === "spellTrap" || zone === "fieldSpell") {
      normalized.facedown = entry?.facedown === true;
    }
    return normalized;
  }

  function normalizeImportedState(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Arquivo de Laboratório deve conter um objeto JSON.");
    }

    let setupPayload = null;
    let optionsPayload = {};
    if (payload.type === "shadow-duel-laboratory-state") {
      setupPayload = payload.setup;
      optionsPayload = { ...payload, ...(payload.options || {}) };
    } else if (payload.player || payload.bot) {
      setupPayload = payload;
      optionsPayload = payload;
    } else {
      throw new Error("Formato de Laboratório inválido.");
    }
    if (!setupPayload || typeof setupPayload !== "object") {
      throw new Error("Setup de Laboratório ausente ou inválido.");
    }

    const warnings = [];
    const normalizedSetup = createEmptyLaboratorySetup();
    const normalizeSide = (owner) => {
      const source = setupPayload[owner] || {};
      const target = normalizedSetup[owner];
      if (typeof source.lp === "number" && Number.isFinite(source.lp)) {
        target.lp = Math.max(0, Math.floor(source.lp));
      }

      LAB_ZONE_CONFIG.forEach((zoneConfig) => {
        const zone = zoneConfig.id;
        const raw =
          zone === "fieldSpell" && !Array.isArray(source[zone])
            ? source[zone]
              ? [source[zone]]
              : []
            : Array.isArray(source[zone])
              ? source[zone]
              : [];
        const limit = zoneConfig.max || Number.POSITIVE_INFINITY;
        const entries = [];
        for (const rawEntry of raw) {
          if (entries.length >= limit) {
            warnings.push(`${LAB_ZONE_LABELS[zone]} excedeu o limite e foi cortado.`);
            break;
          }
          const normalizedEntry = normalizeImportedEntry(
            rawEntry,
            zone,
            warnings,
          );
          if (normalizedEntry) entries.push(normalizedEntry);
        }
        target[zone] = entries;
      });
    };

    normalizeSide("player");
    normalizeSide("bot");

    return {
      setup: normalizedSetup,
      options: {
        useBot:
          typeof optionsPayload.useBot === "boolean"
            ? optionsPayload.useBot
            : dom.useBotInput?.checked === true,
        laboratoryMode:
          optionsPayload.laboratoryMode === "duel" ? "duel" : "test",
        revealBotHand:
          typeof optionsPayload.revealBotHand === "boolean"
            ? optionsPayload.revealBotHand
            : dom.revealBotHandInput?.checked === true,
        botPreset:
          typeof optionsPayload.botPreset === "string"
            ? optionsPayload.botPreset
            : dom.botArchetypeSelect?.value || null,
      },
      warnings,
    };
  }

  async function importStateFromFile(file) {
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (err) {
      alert(`Erro ao ler JSON do Laboratório: ${err.message}`);
      return;
    }

    try {
      const result = normalizeImportedState(parsed);
      laboratorySetup = result.setup;
      if (dom.useBotInput) {
        dom.useBotInput.checked = result.options.useBot;
      }
      if (dom.revealBotHandInput) {
        dom.revealBotHandInput.checked = result.options.revealBotHand;
      }
      if (dom.botArchetypeSelect && result.options.botPreset) {
        dom.botArchetypeSelect.value = result.options.botPreset;
      }
      setMode(result.options.laboratoryMode);
      dom.botArchetypeWrap?.classList.toggle("hidden", !dom.useBotInput?.checked);
      updateAddControls();
      render();
      const warningText = result.warnings.length
        ? `\n\nAvisos:\n- ${result.warnings.join("\n- ")}`
        : "";
      alert(`Estado do Laboratório importado com sucesso.${warningText}`);
    } catch (err) {
      alert(`Erro ao importar estado do Laboratório: ${err.message}`);
    }
  }

  function open() {
    startScreenRoot?.classList.add("hidden");
    dom.modal?.classList.remove("hidden");
    populateControls();
    updateAddControls();
    render();
  }

  function close() {
    dom.modal?.classList.add("hidden");
    startScreenRoot?.classList.remove("hidden");
  }

  function clear() {
    laboratorySetup = createEmptyLaboratorySetup();
    render();
  }

  function hideForDuel(deckBuilderRoot) {
    dom.modal?.classList.add("hidden");
    startScreenRoot?.classList.add("hidden");
    deckBuilderRoot?.classList.add("hidden");
  }

  function getStartConfig() {
    return {
      useBot: dom.useBotInput?.checked || false,
      botPreset: dom.botArchetypeSelect?.value || "shadowheart",
      revealBotHand: dom.revealBotHandInput?.checked || false,
      laboratoryMode,
      setup: buildSetupForGame(),
      duelDecks: buildDuelDecks(),
    };
  }

  function bind({ onStart } = {}) {
    dom.closeButton?.addEventListener("click", close);
    dom.clearButton?.addEventListener("click", clear);
    dom.randomAllButton?.addEventListener("click", randomizeAll);
    dom.exportButton?.addEventListener("click", downloadState);
    dom.importButton?.addEventListener("click", () => {
      dom.importFileInput?.click();
    });
    dom.importFileInput?.addEventListener("change", async () => {
      const file = dom.importFileInput.files?.[0] || null;
      await importStateFromFile(file);
      dom.importFileInput.value = "";
    });
    dom.startButton?.addEventListener("click", () => onStart?.());
    dom.useBotInput?.addEventListener("change", () => {
      dom.botArchetypeWrap?.classList.toggle("hidden", !dom.useBotInput.checked);
    });
    dom.modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        setMode(button.dataset.laboratoryMode);
      });
    });
    dom.addCardButton?.addEventListener("click", addSelectedCard);
    dom.facedownInput?.addEventListener("change", () => {
      dom.facedownInput.dataset.touched = "true";
    });
    dom.addOwnerSelect?.addEventListener("change", () => {
      laboratorySelection.owner = dom.addOwnerSelect.value;
      render();
    });
    dom.addZoneSelect?.addEventListener("change", () => {
      laboratorySelection.zone = dom.addZoneSelect.value;
      updateAddControls();
      render();
    });
    dom.body?.addEventListener("input", (event) => {
      const owner = event.target?.dataset?.labLp;
      if (!owner || !laboratorySetup[owner]) return;
      laboratorySetup[owner].lp = Math.max(
        0,
        Math.floor(Number(event.target.value) || 0),
      );
    });
    dom.body?.addEventListener("click", (event) => {
      const removeSpec = event.target?.dataset?.labRemove;
      if (removeSpec) {
        const [owner, zone, indexRaw] = removeSpec.split(":");
        const index = Number.parseInt(indexRaw, 10);
        const entries = getLabZone(owner, zone);
        if (!Number.isNaN(index)) {
          entries.splice(index, 1);
          render();
        }
        return;
      }

      const randomSpec = event.target?.dataset?.labRandomZone;
      if (randomSpec) {
        const [owner, zone] = randomSpec.split(":");
        randomizeZone(owner, zone);
        render();
        return;
      }

      const randomSide = event.target?.dataset?.labRandomSide;
      if (randomSide) {
        randomizeSide(randomSide);
        return;
      }

      const zoneEl = event.target?.closest?.(".laboratory-zone");
      if (zoneEl?.dataset?.owner && zoneEl?.dataset?.zone) {
        applyZoneSelection(zoneEl.dataset.owner, zoneEl.dataset.zone);
      }
    });
  }

  return {
    bind,
    close,
    getStartConfig,
    hideForDuel,
    open,
  };
}
