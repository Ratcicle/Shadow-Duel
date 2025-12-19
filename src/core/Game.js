import Player from "./Player.js";
import Bot from "./Bot.js";
import Renderer from "../ui/Renderer.js";
import EffectEngine from "./EffectEngine.js";
import Card from "./Card.js";
import { cardDatabaseByName, cardDatabaseById } from "../data/cards.js";
import { getCardDisplayName } from "./i18n.js";
import AutoSelector from "./AutoSelector.js";

// Helper to construct user-friendly cost type descriptions
function getCostTypeDescription(costFilters, count) {
  if (costFilters.archetype) {
    const baseType = costFilters.cardKind || "monster";
    const singular = `"${costFilters.archetype}" ${baseType}`;
    const plural = `"${costFilters.archetype}" ${baseType}s`;
    return count > 1 ? plural : singular;
  }

  if (costFilters.cardKind) {
    const singular = costFilters.cardKind;
    const plural = costFilters.cardKind + "s";
    return count > 1 ? plural : singular;
  }

  return count > 1 ? "cards" : "card";
}

export default class Game {
  constructor(options = {}) {
    this.player = new Player("player", "You");
    this.botPreset = options.botPreset || "shadowheart";
    this.bot = new Bot(this.botPreset);
    this.renderer = new Renderer();
    this.effectEngine = new EffectEngine(this);
    this.autoSelector = new AutoSelector(this);

    this.player.game = this;
    this.bot.game = this;

    this.turn = "player";
    this.phase = "draw";
    this.turnCounter = 0;
    this.gameOver = false;
    this.targetSelection = null;
    this.selectionState = "idle";
    this.graveyardSelection = null;
    this.eventListeners = {};
    this.phaseDelayMs = 400;
    this.lastAttackNegated = false;
    this.pendingSpecialSummon = null; // Track pending special summon (e.g., Leviathan from Eel)
    this.isResolvingEffect = false; // Lock player actions while resolving an effect
    this.trapPromptInProgress = false; // Avoid multiple trap prompts simultaneously
    this.testModeEnabled = false;
    this.devModeEnabled = !!options.devMode;
  }

  setDevMode(enabled) {
    this.devModeEnabled = !!enabled;
  }

  devLog(tag, detail) {
    if (!this.devModeEnabled) return;
    const prefix = `[DEV] ${tag}`;
    const logMessage =
      detail && typeof detail === "object"
        ? `${prefix}: ${
            typeof detail.summary === "string"
              ? detail.summary
              : JSON.stringify(detail)
          }`
        : `${prefix}: ${detail ?? ""}`;
    console.debug(logMessage);
    if (this.renderer?.log) {
      this.renderer.log(logMessage);
    }
  }

  on(eventName, handler) {
    if (!this.eventListeners[eventName]) {
      this.eventListeners[eventName] = [];
    }
    this.eventListeners[eventName].push(handler);
  }

  async emit(eventName, payload) {
    const list = this.eventListeners[eventName];
    if (list) {
      for (const fn of list) {
        try {
          fn(payload);
        } catch (err) {
          console.error("Error in event handler for " + eventName + ":", err);
        }
      }
    }

    if (
      this.effectEngine &&
      typeof this.effectEngine.handleEvent === "function"
    ) {
      this.effectEngine.handleEvent(eventName, payload);
    }

    // Check for traps that respond to this event (e.g., after_summon)
    // Only check player's traps, and only if opponent performed the action
    if (eventName === "after_summon" && payload && payload.player) {
      // From player's perspective, bot is the opponent
      const isOpponentSummon = payload.player.id !== "player";

      await this.checkAndOfferTraps(eventName, {
        ...payload,
        isOpponentSummon: isOpponentSummon,
      });
    }

    return undefined;
  }

  start(deckList = null, extraDeckList = null) {
    this.player.buildDeck(deckList);
    this.player.buildExtraDeck(extraDeckList);
    this.bot.buildDeck();
    this.bot.buildExtraDeck();
    if (this.testModeEnabled) {
      this.forceOpeningHand("Infinity Searcher", 4);
      this.renderer.log(
        "Modo teste: adicionando 4 Infinity Searcher a mao inicial."
      );
    }

    for (let i = 0; i < 4; i++) {
      this.player.draw();
      this.bot.draw();
    }

    this.updateBoard();
    this.startTurn();
    this.renderer.bindPhaseClick((phase) => {
      if (this.turn !== "player") return;
      if (
        this.phase === "main1" ||
        this.phase === "battle" ||
        this.phase === "main2"
      ) {
        this.skipToPhase(phase);
      }
    });
    this.bindCardInteractions();
  }

  forceOpeningHand(cardName, count) {
    if (!cardName || count <= 0) return;
    const data = cardDatabaseByName.get(cardName);
    if (!data || !this.player || !Array.isArray(this.player.deck)) return;

    const ensured = [];
    for (let i = 0; i < count; i++) {
      const idx = this.player.deck.findIndex((card) => card?.name === cardName);
      if (idx !== -1) {
        ensured.push(this.player.deck.splice(idx, 1)[0]);
      } else {
        ensured.push(new Card(data, this.player.id));
      }
    }

    ensured.forEach((card) => this.player.deck.push(card));
  }

  updateBoard() {
    // Update passive effects before rendering
    this.effectEngine?.updatePassiveBuffs();
    if (typeof this.player.updatePassiveEffects === "function") {
      this.player.updatePassiveEffects();
    }
    if (typeof this.bot.updatePassiveEffects === "function") {
      this.bot.updatePassiveEffects();
    }

    this.renderer.renderHand(this.player);
    this.renderer.renderField(this.player);
    this.renderer.renderFieldSpell(this.player);

    if (typeof this.renderer.renderSpellTrap === "function") {
      this.renderer.renderSpellTrap(this.player);
      this.renderer.renderSpellTrap(this.bot);
    } else {
      console.warn("Renderer missing renderSpellTrap implementation.");
    }

    this.renderer.renderHand(this.bot);
    this.renderer.renderField(this.bot);
    this.renderer.renderFieldSpell(this.bot);
    this.renderer.updateLP(this.player);
    this.renderer.updateLP(this.bot);
    this.renderer.updatePhaseTrack(this.phase);
    this.renderer.updateTurn(this.turn === "player" ? this.player : this.bot);
    this.renderer.updateGYPreview(this.player);
    this.renderer.updateGYPreview(this.bot);

    if (typeof this.renderer.updateExtraDeckPreview === "function") {
      this.renderer.updateExtraDeckPreview(this.player);
      this.renderer.updateExtraDeckPreview(this.bot);
    }

    if (this.targetSelection?.usingFieldTargeting) {
      this.highlightTargetCandidates();
    }

    // Highlight cards ready for special summon after rendering
    if (this.pendingSpecialSummon) {
      this.highlightReadySpecialSummon();
    }
  }

  chooseSpecialSummonPosition(player, card = null) {
    if (!player || player.id !== "player") {
      return "attack";
    }

    if (
      this.renderer &&
      typeof this.renderer.showSpecialSummonPositionModal === "function"
    ) {
      return new Promise((resolve) => {
        this.renderer.showSpecialSummonPositionModal(card, (choice) => {
          resolve(choice === "defense" ? "defense" : "attack");
        });
      });
    }

    // Fallback: return a Promise that always resolves to "attack"
    return Promise.resolve("attack");
  }

  async startTurn() {
    this.turnCounter += 1;
    this.phase = "draw";

    const activePlayer = this.turn === "player" ? this.player : this.bot;
    const opponent = activePlayer === this.player ? this.bot : this.player;
    activePlayer.field.forEach((card) => {
      card.hasAttacked = false;
      card.attacksUsedThisTurn = 0;
      card.positionChangedThisTurn = false;
      card.canMakeSecondAttackThisTurn = false;
      card.secondAttackUsedThisTurn = false;
      card.battleIndestructibleOncePerTurnUsed = false;

      const shouldRestrictAttack =
        card.cannotAttackUntilTurn &&
        this.turnCounter <= card.cannotAttackUntilTurn;
      card.cannotAttackThisTurn = shouldRestrictAttack;

      if (!shouldRestrictAttack && card.cannotAttackUntilTurn) {
        card.cannotAttackUntilTurn = null;
      }
      if (
        card.immuneToOpponentEffectsUntilTurn &&
        this.turnCounter > card.immuneToOpponentEffectsUntilTurn
      ) {
        card.immuneToOpponentEffectsUntilTurn = null;
      }
    });
    activePlayer.summonCount = 0;
    activePlayer.additionalNormalSummons = 0;

    this.updateBoard();

    activePlayer.draw();
    this.updateBoard();
    await this.waitForPhaseDelay();

    this.phase = "standby";
    this.updateBoard();
    this.emit("standby_phase", { player: activePlayer, opponent });
    await this.waitForPhaseDelay();

    this.phase = "main1";
    this.updateBoard();
    if (this.turn === "bot" && !this.gameOver) {
      this.bot.makeMove(this);
    }
  }

  waitForPhaseDelay() {
    return new Promise((resolve) =>
      setTimeout(resolve, this.phaseDelayMs || 0)
    );
  }

  async nextPhase() {
    if (this.gameOver) return;
    if (this.isResolvingEffect) {
      this.renderer.log(
        "⚠️ Finalize o efeito pendente antes de mudar de fase."
      );
      return;
    }

    // Oferecer ativação de traps genéricas no final da fase atual
    await this.checkAndOfferTraps("phase_end", {
      currentPhase: this.phase,
    });

    const order = ["draw", "standby", "main1", "battle", "main2", "end"];
    const idx = order.indexOf(this.phase);
    if (idx === -1) return;
    const next = order[idx + 1];
    if (!next) {
      this.endTurn();
      return;
    }
    this.phase = next;

    this.updateBoard();

    if (this.turn === "bot" && !this.gameOver) {
      this.bot.makeMove(this);
    }
  }

  endTurn() {
    if (this.isResolvingEffect) {
      this.renderer.log(
        "⚠️ Finalize o efeito pendente antes de terminar o turno."
      );
      return;
    }
    this.cleanupTempBoosts(this.player);
    this.cleanupTempBoosts(this.bot);
    this.turn = this.turn === "player" ? "bot" : "player";
    this.startTurn();
  }

  showIgnitionActivateModal(card, onActivate) {
    const overlay = document.createElement("div");
    overlay.classList.add("modal", "ignition-overlay");

    const modal = document.createElement("div");
    modal.classList.add("modal-content", "ignition-modal");

    const title = document.createElement("h3");
    const titleText =
      (card && getCardDisplayName(card)) ||
      (card?.name && card.name) ||
      "Activate effect?";
    title.textContent = titleText;
    title.classList.add("modal-title");

    const desc = document.createElement("p");
    desc.textContent = "Activate this monster's effect?";
    desc.classList.add("modal-text");

    const actions = document.createElement("div");
    actions.classList.add("modal-actions");

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.classList.add("secondary");
    const activateBtn = document.createElement("button");
    activateBtn.textContent = "Activate";

    const cleanup = () => {
      overlay.remove();
    };

    cancelBtn.onclick = () => cleanup();
    activateBtn.onclick = () => {
      cleanup();
      if (typeof onActivate === "function") onActivate();
    };

    actions.appendChild(cancelBtn);
    actions.appendChild(activateBtn);
    modal.appendChild(title);
    modal.appendChild(desc);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  skipToPhase(targetPhase) {
    if (this.isResolvingEffect) {
      this.renderer.log(
        "⚠️ Finalize o efeito pendente antes de mudar de fase."
      );
      return;
    }
    const order = ["draw", "standby", "main1", "battle", "main2", "end"];
    const currentIdx = order.indexOf(this.phase);
    const targetIdx = order.indexOf(targetPhase);
    if (currentIdx === -1 || targetIdx === -1) return;
    if (targetIdx <= currentIdx) return;
    this.phase = targetPhase;
    if (this.phase === "end") {
      this.endTurn();
      return;
    }
    this.updateBoard();
    if (this.turn === "bot" && this.phase !== "draw" && !this.gameOver) {
      this.bot.makeMove(this);
    }
  }

  bindCardInteractions() {
    this.devLog("BIND_INTERACTIONS", {
      summary: "Binding card interaction handlers",
    });

    let tributeSelectionMode = false;
    let selectedTributes = [];
    let pendingSummon = null;

    document.getElementById("player-hand").addEventListener("click", (e) => {
      if (this.targetSelection) return;
      if (this.turn !== "player") return;

      const cardEl = e.target.closest(".card");
      if (!cardEl) return;

      if (tributeSelectionMode) return;

      const index = parseInt(cardEl.dataset.index);
      const card = this.player.hand[index];

      if (!card) return;

      // If resolving an effect, only allow the specific pending action
      if (this.isResolvingEffect) {
        if (
          this.pendingSpecialSummon &&
          card.name === this.pendingSpecialSummon.cardName
        ) {
          // Show position choice for special summon
          if (
            this.renderer &&
            typeof this.renderer.showSpecialSummonPositionModal === "function"
          ) {
            this.renderer.showSpecialSummonPositionModal(card, (choice) => {
              const position = choice === "defense" ? "defense" : "attack";
              this.performSpecialSummon(index, position);
            });
          } else {
            this.performSpecialSummon(index, "attack");
          }
        } else {
          this.renderer.log(
            "⚠️ Finalize o efeito pendente antes de fazer outra ação."
          );
        }
        return;
      }

      if (card.cardKind === "monster") {
        if (this.phase !== "main1" && this.phase !== "main2") return;

        const canSanctumSpecialFromAegis =
          card.name === "Luminarch Sanctum Protector" &&
          this.player.field.length < 5 &&
          this.player.field.some(
            (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown
          );

        const tributeInfo = this.player.getTributeRequirement(card);
        const tributesNeeded = tributeInfo.tributesNeeded;

        if (
          tributesNeeded > 0 &&
          this.player.field.length < tributesNeeded &&
          !canSanctumSpecialFromAegis
        ) {
          this.renderer.log(
            `Not enough tributes for Level ${card.level} monster.`
          );
          return;
        }

        // Find first hand ignition effect, if any
        const handEffect = (card.effects || []).find(
          (e) => e && e.timing === "ignition" && e.requireZone === "hand"
        );

        // Generic pre-check for hand effects (filters, OPT, targets, phase/turn)
        const handEffectPreview = handEffect
          ? this.effectEngine.canActivateMonsterEffectPreview(
              card,
              this.player,
              "hand"
            )
          : { ok: false };

        const canUseHandEffect = handEffectPreview.ok;
        const handEffectLabel = "Special Summon";

        this.renderer.showSummonModal(
          index,
          (choice) => {
            if (choice === "special_from_aegisbearer") {
              this.specialSummonSanctumProtectorFromHand(index);
              return;
            }

            if (choice === "special_from_void_forgotten") {
              this.tryActivateMonsterEffect(card, null, "hand");
              return;
            }

            if (choice === "special_from_hand_effect") {
              console.log("[Game] Activating hand effect for:", card.name);
              this.tryActivateMonsterEffect(card, null, "hand");
              return;
            }
            if (choice === "attack" || choice === "defense") {
              const position = choice;
              const isFacedown = choice === "defense";

              if (tributesNeeded > 0) {
                tributeSelectionMode = true;
                selectedTributes = [];
                pendingSummon = {
                  cardIndex: index,
                  position,
                  isFacedown,
                  tributesNeeded,
                };

                this.player.field.forEach((_, idx) => {
                  const fieldCard = document.querySelector(
                    `#player-field .card[data-index="${idx}"]`
                  );
                  if (fieldCard) {
                    fieldCard.classList.add("tributeable");
                  }
                });

                this.renderer.log(
                  `Select ${tributesNeeded} monster(s) to tribute.`
                );
              } else {
                const before = this.player.field.length;
                const result = this.player.summon(index, position, isFacedown);
                if (!result && this.player.field.length === before) {
                  this.updateBoard();
                  return;
                }
                const summonedCard =
                  this.player.field[this.player.field.length - 1];
                summonedCard.summonedTurn = this.turnCounter;
                summonedCard.positionChangedThisTurn = false;
                if (summonedCard.isFacedown) {
                  summonedCard.setTurn = this.turnCounter;
                } else {
                  summonedCard.setTurn = null;
                }
                this.emit("after_summon", {
                  card: summonedCard,
                  player: this.player,
                  method: "normal",
                  fromZone: "hand",
                });
                this.updateBoard();
              }
            }
          },
          {
            canSanctumSpecialFromAegis,
            specialSummonFromHand: false,
            specialSummonFromHandEffect: canUseHandEffect,
            specialSummonFromHandEffectLabel: handEffectLabel,
          }
        );
        return;
      }

      if (card.cardKind === "spell") {
        if (this.phase !== "main1" && this.phase !== "main2") {
          this.renderer.log("Can only activate spells during Main Phase.");
          return;
        }

        // Special check for Polymerization
        const spellPreview = this.effectEngine?.canActivateSpellFromHandPreview(
          card,
          this.player
        ) || { ok: true };
        let canActivateFromHand = !!spellPreview.ok;

        if (card.name === "Polymerization") {
          if (!this.canActivatePolymerization()) {
            canActivateFromHand = false;
          }
        }

        const handleSpellChoice = (choice) => {
          if (choice === "activate") {
            this.tryActivateSpell(card, index);
          } else if (choice === "set") {
            this.setSpellOrTrap(card, index);
          }
        };

        if (
          this.renderer &&
          typeof this.renderer.showSpellChoiceModal === "function"
        ) {
          this.renderer.showSpellChoiceModal(index, handleSpellChoice, {
            canActivate: canActivateFromHand,
          });
        } else {
          const shouldActivate = window.confirm(
            "OK: Activate this Spell. Cancel: Set it face-down in your Spell/Trap Zone."
          );
          handleSpellChoice(shouldActivate ? "activate" : "set");
        }
        return;
      }

      if (card.cardKind === "trap") {
        this.setSpellOrTrap(card, index);
        return;
      }
    });

    document
      .getElementById("player-field")
      .addEventListener("click", async (e) => {
        const cardEl = e.target.closest(".card");
        if (!cardEl) return;
        if (this.isResolvingEffect) {
          this.renderer.log(
            "⚠️ Finalize o efeito pendente antes de fazer outra ação."
          );
          return;
        }

        const index = parseInt(cardEl.dataset.index);
        if (Number.isNaN(index)) return;

        if (
          this.targetSelection &&
          this.handleTargetSelectionClick("player", index, cardEl, "field")
        ) {
          return;
        }

        if (tributeSelectionMode && pendingSummon) {
          if (!cardEl.classList.contains("tributeable")) return;

          if (selectedTributes.includes(index)) {
            selectedTributes = selectedTributes.filter((i) => i !== index);
            cardEl.classList.remove("selected");
          } else if (selectedTributes.length < pendingSummon.tributesNeeded) {
            selectedTributes.push(index);
            cardEl.classList.add("selected");
          }

          if (selectedTributes.length === pendingSummon.tributesNeeded) {
            document.querySelectorAll(".tributeable").forEach((el) => {
              el.classList.remove("tributeable", "selected");
            });

            const before = this.player.field.length;
            const result = this.player.summon(
              pendingSummon.cardIndex,
              pendingSummon.position,
              pendingSummon.isFacedown,
              selectedTributes
            );

            if (!result && this.player.field.length === before) {
              tributeSelectionMode = false;
              selectedTributes = [];
              pendingSummon = null;
              this.updateBoard();
              return;
            }

            const summonedCard =
              this.player.field[this.player.field.length - 1];
            summonedCard.summonedTurn = this.turnCounter;
            summonedCard.positionChangedThisTurn = false;
            if (summonedCard.isFacedown) {
              summonedCard.setTurn = this.turnCounter;
            } else {
              summonedCard.setTurn = null;
            }

            this.emit("after_summon", {
              card: summonedCard,
              player: this.player,
              method: pendingSummon.tributesNeeded > 0 ? "tribute" : "normal",
              fromZone: "hand",
            });

            tributeSelectionMode = false;
            selectedTributes = [];
            pendingSummon = null;

            this.updateBoard();
          }
          return;
        }

        if (
          this.turn === "player" &&
          (this.phase === "main1" || this.phase === "main2")
        ) {
          const card = this.player.field[index];
          if (!card || card.cardKind !== "monster") return;

          // Verificar se tem efeito ignition ativável
          const hasIgnition =
            card.effects &&
            card.effects.some((eff) => eff && eff.timing === "ignition");

          const canFlip = this.canFlipSummon(card);
          const canPosChange = this.canChangePosition(card);

          // Se tem qualquer opção disponível, mostrar o modal unificado
          if (hasIgnition || canFlip || canPosChange) {
            if (e && typeof e.stopImmediatePropagation === "function") {
              e.stopImmediatePropagation();
            }

            this.renderer.showPositionChoiceModal(
              cardEl,
              card,
              (choice) => {
                if (choice === "flip" && canFlip) {
                  this.flipSummon(card);
                } else if (
                  choice === "to_attack" &&
                  canPosChange &&
                  card.position !== "attack"
                ) {
                  this.changeMonsterPosition(card, "attack");
                } else if (
                  choice === "to_defense" &&
                  canPosChange &&
                  card.position !== "defense"
                ) {
                  this.changeMonsterPosition(card, "defense");
                }
              },
              {
                canFlip,
                canChangePosition: canPosChange,
                hasIgnitionEffect: hasIgnition,
                onActivateEffect: hasIgnition
                  ? () => this.tryActivateMonsterEffect(card)
                  : null,
              }
            );
            return;
          }
        }

        if (this.turn !== "player" || this.phase !== "battle") return;

        const attacker = this.player.field[index];

        if (attacker) {
          const availability = this.getAttackAvailability(attacker);
          if (!availability.ok) {
            this.renderer.log(availability.reason);
            return;
          }

          const canUseSecondAttack =
            attacker.canMakeSecondAttackThisTurn &&
            !attacker.secondAttackUsedThisTurn;

          if (attacker.hasAttacked && !canUseSecondAttack) {
            this.renderer.log("This monster has already attacked!");
            return;
          }

          const opponentTargets = this.bot.field.filter(
            (card) => card && card.cardKind === "monster"
          );

          const attackCandidates =
            opponentTargets.filter((card) => card && card.mustBeAttacked)
              .length > 0
              ? opponentTargets.filter((card) => card && card.mustBeAttacked)
              : opponentTargets;

          const canDirect = attacker.canAttackDirectlyThisTurn === true;

          if (canDirect) {
            this.startAttackTargetSelection(attacker, attackCandidates);
          } else if (attackCandidates.length === 0) {
            await this.resolveCombat(attacker, null);
          } else {
            this.startAttackTargetSelection(attacker, attackCandidates);
          }
        }
      });

    const playerSpellTrapEl = document.getElementById("player-spelltrap");
    if (playerSpellTrapEl) {
      playerSpellTrapEl.addEventListener("click", async (e) => {
        console.log(`[Game] Spell/Trap zone clicked! Target:`, e.target);

        if (this.targetSelection) {
          const cardEl = e.target.closest(".card");
          if (cardEl) {
            const idx = parseInt(cardEl.dataset.index);
            if (!Number.isNaN(idx)) {
              const handled = this.handleTargetSelectionClick(
                "player",
                idx,
                cardEl,
                "spellTrap"
              );
              if (handled) return;
            }
          }
          console.log(`[Game] Returning: targetSelection active`);
          return;
        }
        if (this.isResolvingEffect) {
          this.renderer.log(
            "⚠️ Finalize o efeito pendente antes de fazer outra ação."
          );
          return;
        }
        if (this.turn !== "player") {
          console.log(`[Game] Returning: not player turn (${this.turn})`);
          return;
        }
        if (this.phase !== "main1" && this.phase !== "main2") {
          console.log(`[Game] Returning: wrong phase (${this.phase})`);
          return;
        }

        const cardEl = e.target.closest(".card");
        if (!cardEl) return;

        const index = parseInt(cardEl.dataset.index);
        if (Number.isNaN(index)) return;

        const card = this.player.spellTrap[index];
        if (!card) return;

        console.log(
          `[Game] Clicked spell/trap: ${card.name}, isFacedown: ${card.isFacedown}, cardKind: ${card.cardKind}`
        );

        // Handle traps (can be facedown with on_activate timing)
        if (card.cardKind === "trap") {
          const hasActivateEffect = (card.effects || []).some(
            (e) => e && e.timing === "on_activate"
          );

          if (hasActivateEffect) {
            // Check if trap can be activated (waited at least 1 turn)
            if (!this.canActivateTrap(card)) {
              this.renderer.log(
                "Esta armadilha não pode ser ativada neste turno."
              );
              return;
            }

            console.log(`[Game] Activating trap: ${card.name}`);
            await this.tryActivateSpellTrapEffect(card);
          }
          return;
        }

        // For spells, don't allow clicking facedown cards
        if (card.isFacedown) return;

        // Handle continuous spells and ignition effects
        if (card.cardKind === "spell") {
          const hasIgnition = (card.effects || []).some(
            (e) => e.timing === "ignition"
          );
          if (hasIgnition) {
            console.log(
              `[Game] Clicking continuous spell/ignition: ${card.name}`
            );
            await this.tryActivateSpellTrapEffect(card);
          }
        }
      });
    }

    document.getElementById("bot-field").addEventListener("click", (e) => {
      if (!this.targetSelection) return;
      const cardEl = e.target.closest(".card");
      if (!cardEl) return;

      const index = parseInt(cardEl.dataset.index);
      if (Number.isNaN(index)) return;

      this.handleTargetSelectionClick("bot", index, cardEl, "field");
    });

    // Direcionar ataque direto: clicar na mão do oponente quando houver alvo "Direct Attack"
    const botSpellTrapEl = document.getElementById("bot-spelltrap");
    if (botSpellTrapEl) {
      botSpellTrapEl.addEventListener("click", (e) => {
        if (!this.targetSelection) return;
        const cardEl = e.target.closest(".card");
        if (!cardEl) return;

        const index = parseInt(cardEl.dataset.index);
        if (Number.isNaN(index)) return;

        this.handleTargetSelectionClick("bot", index, cardEl, "spellTrap");
      });
    }

    const botHandEl = document.getElementById("bot-hand");
    if (botHandEl) {
      botHandEl.addEventListener("click", (e) => {
        if (!this.targetSelection) return;
        if (this.targetSelection.kind !== "attack") return;
        const requirement = this.targetSelection.requirements?.[0];
        if (!requirement) return;

        const directCandidate = requirement.candidates.find(
          (c) => c && c.isDirectAttack
        );
        if (!directCandidate) return;

        // Seleciona o índice do ataque direto e finaliza seleção
        this.targetSelection.selections[requirement.id] = [
          directCandidate.key,
        ];
        this.targetSelection.currentRequirement =
          this.targetSelection.requirements.length;
        this.setSelectionState("confirming");
        this.finishTargetSelection();
        e.stopPropagation();
      });
    }

    // Field spell effects for player
    const playerFieldSpellEl = document.getElementById("player-fieldspell");
    if (playerFieldSpellEl) {
      playerFieldSpellEl.addEventListener("click", (e) => {
        const cardEl = e.target.closest(".card");
        if (!cardEl) return;
        if (this.targetSelection) {
          this.handleTargetSelectionClick("player", 0, cardEl, "fieldSpell");
          return;
        }
        const card = this.player.fieldSpell;
        if (card) {
          this.activateFieldSpellEffect(card);
        }
      });
    }

    const botFieldSpellEl = document.getElementById("bot-fieldspell");
    if (botFieldSpellEl) {
      botFieldSpellEl.addEventListener("click", (e) => {
        if (!this.targetSelection) return;
        const cardEl = e.target.closest(".card");
        if (!cardEl) return;
        this.handleTargetSelectionClick("bot", 0, cardEl, "fieldSpell");
      });
    }
    this.renderer.bindCardHover((owner, location, index) => {
      let card = null;
      const playerObj = owner === "player" ? this.player : this.bot;

      if (location === "hand") {
        card = playerObj.hand[index];
      } else if (location === "field") {
        card = playerObj.field[index];
      } else if (location === "spellTrap") {
        card = playerObj.spellTrap[index];
      } else if (location === "fieldSpell") {
        card = playerObj.fieldSpell;
      }

      if (card) {
        if (card.isFacedown && owner === "bot") {
          this.renderer.renderPreview(null);
        } else {
          this.renderer.renderPreview(card);
        }
      }
    });

    const showGY = (player) => {
      this.openGraveyardModal(player);
    };

    document
      .getElementById("player-graveyard")
      .addEventListener("click", () => showGY(this.player));
    document
      .getElementById("bot-graveyard")
      .addEventListener("click", () => showGY(this.bot));

    const showExtraDeck = (player) => {
      if (player.id !== "player") return; // Only player can view their Extra Deck
      this.openExtraDeckModal(player);
    };

    document
      .getElementById("player-extradeck")
      .addEventListener("click", () => showExtraDeck(this.player));

    document.querySelector(".close-modal").addEventListener("click", () => {
      this.closeGraveyardModal();
    });

    const closeExtraDeckBtn = document.querySelector(".close-extradeck");
    if (closeExtraDeckBtn) {
      closeExtraDeckBtn.addEventListener("click", () => {
        this.closeExtraDeckModal();
      });
    }

    window.addEventListener("click", (e) => {
      const modal = document.getElementById("gy-modal");
      const extraModal = document.getElementById("extradeck-modal");
      if (e.target === modal) {
        this.closeGraveyardModal();
      }
      if (e.target === extraModal) {
        this.closeExtraDeckModal();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (this.graveyardSelection) {
          this.closeGraveyardModal();
        } else {
          this.cancelTargetSelection();
        }
      }
    });
  }

  specialSummonSanctumProtectorFromHand(handIndex) {
    if (this.turn !== "player") return;
    if (this.phase !== "main1" && this.phase !== "main2") return;
    if (this.player.field.length >= 5) {
      this.renderer.log("Field is full (max 5 monsters).");
      return;
    }

    const card = this.player.hand[handIndex];
    if (!card || card.name !== "Luminarch Sanctum Protector") return;

    const aegis = this.player.field.find(
      (c) => c && c.name === "Luminarch Aegisbearer" && !c.isFacedown
    );

    if (!aegis) {
      this.renderer.log('No face-up "Luminarch Aegisbearer" to send.');
      return;
    }

    this.moveCard(aegis, this.player, "graveyard", { fromZone: "field" });

    const idxInHand = this.player.hand.indexOf(card);
    if (idxInHand === -1) return;
    this.player.hand.splice(idxInHand, 1);

    const finalizeSummon = (positionChoice) => {
      const position = positionChoice === "defense" ? "defense" : "attack";
      card.position = position;
      card.isFacedown = false;
      card.hasAttacked = false;
      card.cannotAttackThisTurn = false;
      card.attacksUsedThisTurn = 0;
      card.positionChangedThisTurn = false;
      card.summonedTurn = this.turnCounter;
      card.setTurn = null;
      card.owner = this.player.id;

    this.player.field.push(card);

    this.emit("after_summon", {
      card,
      player: this.player,
      method: "special",
      fromZone: "hand",
    });

      this.updateBoard();
    };

    const positionChoice = this.chooseSpecialSummonPosition(this.player, card);
    if (positionChoice && typeof positionChoice.then === "function") {
      positionChoice.then((resolved) => finalizeSummon(resolved));
    } else {
      finalizeSummon(positionChoice);
    }
  }

  async resolveDestructionWithReplacement(card, options = {}) {
    if (!card || card.cardKind !== "monster") {
      return { replaced: false };
    }

    const ownerPlayer = card.owner === "player" ? this.player : this.bot;
    if (!ownerPlayer) {
      return { replaced: false };
    }

    const cause = options.cause || options.reason || "effect";

    // Check for Equip Spell protection (e.g., Crescent Shield Guard)
    if (cause === "battle") {
      const guardEquip = (card.equips || []).find(
        (equip) =>
          equip && equip.grantsCrescentShieldGuard && equip.equippedTo === card
      );

      if (guardEquip) {
        this.renderer.log(
          `${guardEquip.name} was destroyed to protect ${card.name}.`
        );
        const guardResult = await this.destroyCard(guardEquip, {
          cause,
          sourceCard: card,
          opponent: this.getOpponent(ownerPlayer),
          fromZone: "spellTrap",
        });
        if (guardResult?.destroyed) {
          guardEquip.grantsCrescentShieldGuard = false;
          return { replaced: true };
        }
        return { replaced: false };
      }
    }

    // Generic destruction replacement system
    // Look for effects with replacementEffect property
    const replacementEffect = (card.effects || []).find(
      (eff) =>
        eff.replacementEffect && eff.replacementEffect.type === "destruction"
    );

    if (!replacementEffect) {
      return { replaced: false };
    }

    const replacement = replacementEffect.replacementEffect;

    // Check once per turn
    const onceCheck = this.effectEngine.checkOncePerTurn(
      card,
      ownerPlayer,
      replacementEffect
    );
    if (!onceCheck.ok) {
      return { replaced: false };
    }

    // Check if reason matches (battle/effect/any)
    if (
      replacement.reason &&
      replacement.reason !== "any" &&
      replacement.reason !== cause
    ) {
      return { replaced: false };
    }

    // Build filter function for cost candidates
    const costFilters = replacement.costFilters || {};
    const filterCandidates = (candidate) => {
      if (!candidate || candidate === card) return false;

      if (costFilters.cardKind && candidate.cardKind !== costFilters.cardKind)
        return false;

      if (costFilters.archetype) {
        const hasArchetype =
          candidate.archetype === costFilters.archetype ||
          (Array.isArray(candidate.archetypes) &&
            candidate.archetypes.includes(costFilters.archetype));
        if (!hasArchetype) return false;
      }

      if (costFilters.name && candidate.name !== costFilters.name) return false;

      return true;
    };

    // Find candidates in the specified zone (default: field)
    const costZone = replacement.costZone || "field";
    const candidateZone = ownerPlayer[costZone] || [];
    const candidates = candidateZone.filter(filterCandidates);

    const costCount = replacement.costCount || 1;

    if (candidates.length < costCount) {
      return { replaced: false };
    }

    // Bot auto-selection (lowest ATK for cost)
    if (ownerPlayer.id !== "player") {
      const chosen = [...candidates]
        .sort((a, b) => (a.atk || 0) - (b.atk || 0))
        .slice(0, costCount);

      for (const costCard of chosen) {
        this.moveCard(costCard, ownerPlayer, "graveyard", {
          fromZone: costZone,
        });
      }

      this.effectEngine.registerOncePerTurnUsage(
        card,
        ownerPlayer,
        replacementEffect
      );

      const costNames = chosen.map((c) => c.name).join(", ");
      this.renderer.log(
        `${card.name} avoided destruction by sending ${costNames} to the Graveyard.`
      );
      return { replaced: true };
    }

    // Player confirmation
    const costDescription = getCostTypeDescription(costFilters, costCount);
    const prompt =
      replacement.prompt ||
      `Send ${costCount} ${costDescription} to the GY to save ${card.name}?`;

    const wantsToReplace = window.confirm(prompt);
    if (!wantsToReplace) {
      return { replaced: false };
    }

    // Player selection
    const selections = await this.askPlayerToSelectCards({
      owner: "player",
      zone: costZone,
      min: costCount,
      max: costCount,
      filter: filterCandidates,
      message:
        replacement.selectionMessage ||
        `Choose ${costCount} ${
          costCount > 1 ? "cards" : "card"
        } to send to the Graveyard for ${card.name}'s protection.`,
    });

    if (!selections || selections.length < costCount) {
      this.renderer.log("Protection cancelled.");
      return { replaced: false };
    }

    // Pay cost
    for (const costCard of selections) {
      this.moveCard(costCard, ownerPlayer, "graveyard", { fromZone: costZone });
    }

    this.effectEngine.registerOncePerTurnUsage(
      card,
      ownerPlayer,
      replacementEffect
    );

    const costNames = selections.map((c) => c.name).join(", ");
    this.renderer.log(
      `${card.name} avoided destruction by sending ${costNames} to the Graveyard.`
    );
    return { replaced: true };
  }

  async destroyCard(card, options = {}) {
    if (!card) {
      return { destroyed: false, reason: "invalid_card" };
    }

    const owner = card.owner === "player" ? this.player : this.bot;
    if (!owner) {
      return { destroyed: false, reason: "missing_owner" };
    }

    const cause = options.cause || options.reason || "effect";
    const sourceCard = options.sourceCard || options.source || null;
    const opponent = options.opponent || this.getOpponent(owner);
    const fromZone =
      options.fromZone ||
      this.effectEngine?.findCardZone?.(owner, card) ||
      null;

    if (!fromZone) {
      return { destroyed: false, reason: "not_in_zone" };
    }

    if (this.effectEngine?.checkBeforeDestroyNegations) {
      const negationResult = await this.effectEngine.checkBeforeDestroyNegations(
        card,
        {
          source: sourceCard,
          player: owner,
          opponent,
          cause,
          fromZone,
        }
      );
      if (negationResult?.negated) {
        return { destroyed: false, negated: true };
      }
    }

    const { replaced } = (await this.resolveDestructionWithReplacement(card, {
      cause,
      sourceCard,
    })) || { replaced: false };

    if (replaced) {
      return { destroyed: false, replaced: true };
    }

    this.moveCard(card, owner, "graveyard", {
      fromZone: fromZone || undefined,
      wasDestroyed: true,
    });

    return { destroyed: true };
  }

  canFlipSummon(card) {
    if (!card) return false;
    const isTurnPlayer = card.owner === this.turn;
    const isMainPhase = this.phase === "main1" || this.phase === "main2";
    if (!isTurnPlayer || !isMainPhase) return false;
    if (!card.isFacedown) return false;
    if (card.positionChangedThisTurn) return false;

    const setTurn = card.setTurn ?? card.summonedTurn ?? 0;
    if (this.turnCounter <= setTurn) return false;

    return true;
  }

  canChangePosition(card) {
    if (!card) return false;
    const isTurnPlayer = card.owner === this.turn;
    const isMainPhase = this.phase === "main1" || this.phase === "main2";
    if (!isTurnPlayer || !isMainPhase) return false;
    if (card.isFacedown) return false;
    if (card.positionChangedThisTurn) return false;
    if (card.summonedTurn && this.turnCounter <= card.summonedTurn)
      return false;
    if (card.hasAttacked) return false;

    return true;
  }

  flipSummon(card) {
    if (!this.canFlipSummon(card)) return;
    card.isFacedown = false;
    card.position = "attack";
    card.positionChangedThisTurn = true;
    card.cannotAttackThisTurn = true;
    this.renderer.log(`${card.name} is Flip Summoned!`);

    this.emit("after_summon", {
      card,
      player: card.owner === "player" ? this.player : this.bot,
      method: "flip",
    });

    this.updateBoard();
  }

  changeMonsterPosition(card, newPosition) {
    if (newPosition !== "attack" && newPosition !== "defense") return;
    if (!this.canChangePosition(card)) return;
    if (!card || card.position === newPosition) return;

    card.position = newPosition;
    card.isFacedown = false;
    card.positionChangedThisTurn = true;
    card.cannotAttackThisTurn = newPosition === "defense";
    this.renderer.log(
      `${card.name} changes to ${
        newPosition === "attack" ? "Attack" : "Defense"
      } Position.`
    );
    this.updateBoard();
  }

  finalizeSpellTrapActivation(card, owner, activationZone = null) {
    if (!card || !owner) return;
    const subtype = card.subtype || "";
    const kind = card.cardKind || "";
    const shouldSendToGY =
      (kind === "spell" &&
        (subtype === "normal" || subtype === "quick-play")) ||
      (kind === "trap" && subtype === "normal");

    if (shouldSendToGY) {
      this.moveCard(card, owner, "graveyard", { fromZone: activationZone });
    }
  }

  async tryActivateMonsterEffect(
    card,
    selections = null,
    activationZone = "field"
  ) {
    if (!card) return;
    console.log(
      `[Game] tryActivateMonsterEffect called for: ${card.name} (zone: ${activationZone})`
    );
    const activationContext = {
      fromHand: activationZone === "hand",
      activationZone,
      sourceZone: activationZone,
      committed: false,
    };

    await this.runActivationPipeline({
      card,
      owner: this.player,
      activationZone,
      activationContext,
      selections,
      selectionKind: "monsterEffect",
      selectionMessage: "Select target(s) for the monster effect.",
      activate: (chosen, ctx, zone) =>
        this.effectEngine.activateMonsterEffect(
          card,
          this.player,
          chosen,
          zone,
          ctx
        ),
      finalize: () => {
        this.renderer.log(`${card.name} effect activated.`);
        this.updateBoard();
      },
    });
  }

  async tryActivateSpellTrapEffect(card, selections = null) {
    if (!card) return;
    console.log(`[Game] tryActivateSpellTrapEffect called for: ${card.name}`);

    // If it's a trap, show confirmation modal first
    if (card.cardKind === "trap") {
      const confirmed = await this.renderer.showTrapActivationModal(
        card,
        "manual_activation"
      );

      if (!confirmed) {
        console.log(`[Game] User cancelled trap activation`);
        return;
      }

      // Flip the trap face-up after confirmation
      if (card.isFacedown) {
        card.isFacedown = false;
        this.renderer.log(`${this.player.name} ativa ${card.name}!`);
        this.updateBoard();
      }
    }

    const activationContext = {
      fromHand: false,
      activationZone: "spellTrap",
      sourceZone: "spellTrap",
      committed: false,
    };

    await this.runActivationPipeline({
      card,
      owner: this.player,
      activationZone: "spellTrap",
      activationContext,
      selections,
      selectionKind: "spellTrapEffect",
      selectionMessage: "Select target(s) for the continuous spell effect.",
      activate: (chosen, ctx, zone) =>
        this.effectEngine.activateSpellTrapEffect(
          card,
          this.player,
          chosen,
          zone,
          ctx
        ),
      finalize: (result, info) => {
        if (result.placementOnly) {
          this.renderer.log(`${card.name} is placed on the field.`);
        } else {
          this.finalizeSpellTrapActivation(card, this.player, info.activationZone);
          this.renderer.log(`${card.name} effect activated.`);
        }
        this.updateBoard();
      },
    });
  }

  buildSelectionCandidateKey(candidate = {}, fallbackIndex = 0) {
    const zone = candidate.zone || "field";
    const zoneIndex =
      typeof candidate.zoneIndex === "number" ? candidate.zoneIndex : -1;
    const controller = candidate.controller || candidate.owner || "unknown";
    const baseId =
      candidate.cardRef?.id ||
      candidate.cardRef?.name ||
      candidate.name ||
      String(fallbackIndex);
    return `${controller}:${zone}:${zoneIndex}:${baseId}`;
  }

  normalizeSelectionContract(contract, overrides = {}) {
    const base =
      contract && typeof contract === "object" && !Array.isArray(contract)
        ? contract
        : {};
    const rawRequirements = Array.isArray(base.requirements)
      ? base.requirements
      : base.requirements
      ? [base.requirements]
      : [];
    const normalizedRequirements = [];

    for (let i = 0; i < rawRequirements.length; i += 1) {
      const req = rawRequirements[i];
      if (!req || typeof req !== "object") {
        return { ok: false, reason: "Invalid selection requirements." };
      }

      const min = Number(req.min ?? req.count?.min ?? 1);
      const max = Number(req.max ?? req.count?.max ?? min);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
        return { ok: false, reason: "Selection requirements are invalid." };
      }

      const zones = Array.isArray(req.zones)
        ? req.zones.filter(Boolean)
        : req.zone
        ? [req.zone]
        : [];
      if (zones.length === 0) {
        return { ok: false, reason: "Selection requirements missing zones." };
      }

      const ownerRaw = req.owner || "player";
      const owner =
        ownerRaw === "opponent"
          ? "opponent"
          : ownerRaw === "either" || ownerRaw === "any"
          ? "either"
          : "player";

      const candidates = Array.isArray(req.candidates)
        ? req.candidates.map((cand, idx) => {
            if (!cand || typeof cand !== "object") return null;
            if (!cand.key) {
              cand.key = this.buildSelectionCandidateKey(cand, idx);
            }
            return cand;
          }).filter(Boolean)
        : [];

      const normalized = {
        id: req.id || `selection_${i + 1}`,
        min,
        max,
        zones,
        owner,
        filters:
          req.filters && typeof req.filters === "object" ? { ...req.filters } : {},
        allowSelf: req.allowSelf !== false,
        distinct: req.distinct !== false,
        candidates,
      };

      normalizedRequirements.push(normalized);
    }

    if (normalizedRequirements.length === 0) {
      return { ok: false, reason: "Selection contract missing requirements." };
    }

    const uiBase =
      base.ui && typeof base.ui === "object" ? base.ui : {};
    const overrideUi =
      overrides.ui && typeof overrides.ui === "object" ? overrides.ui : {};

    const normalizedContract = {
      kind: base.kind || overrides.kind || "target",
      message:
        overrides.message ?? base.message ?? null,
      requirements: normalizedRequirements,
      ui: {
        allowCancel:
          overrideUi.allowCancel ?? uiBase.allowCancel ?? true,
        preventCancel:
          overrideUi.preventCancel ?? uiBase.preventCancel ?? false,
        useFieldTargeting:
          overrideUi.useFieldTargeting ?? uiBase.useFieldTargeting,
        allowEmpty: overrideUi.allowEmpty ?? uiBase.allowEmpty,
      },
      metadata:
        base.metadata && typeof base.metadata === "object"
          ? { ...base.metadata }
          : {},
    };

    return { ok: true, contract: normalizedContract };
  }

  convertLegacyOptionsToSelectionContract(options, overrides = {}) {
    if (!Array.isArray(options) || options.length === 0) {
      return null;
    }

    const requirements = options
      .map((opt, idx) => {
        if (!opt || typeof opt !== "object") return null;
        const candidates = Array.isArray(opt.candidates)
          ? opt.candidates.map((cand, candIdx) => {
              if (!cand || typeof cand !== "object") return null;
              if (!cand.key) {
                cand.key = this.buildSelectionCandidateKey(cand, candIdx);
              }
              return cand;
            }).filter(Boolean)
          : [];
        const zones = Array.isArray(opt.zones)
          ? opt.zones
          : opt.zone
          ? [opt.zone]
          : candidates.length
          ? [...new Set(candidates.map((cand) => cand.zone).filter(Boolean))]
          : ["field"];
        return {
          id: opt.id || `legacy_${idx + 1}`,
          min: Number(opt.min ?? opt.count?.min ?? 1),
          max: Number(opt.max ?? opt.count?.max ?? opt.min ?? 1),
          zones,
          owner: "either",
          filters: {},
          allowSelf: true,
          distinct: true,
          candidates,
        };
      })
      .filter(Boolean);

    const contract = {
      kind: overrides.kind || "target",
      message: overrides.message || null,
      requirements,
      ui: overrides.ui || {},
      metadata: { legacy: true },
    };

    return contract;
  }

  canUseFieldTargeting(requirements) {
    const list = Array.isArray(requirements)
      ? requirements
      : requirements?.requirements || [];
    if (!list || list.length === 0) return false;
    const allowedZones = new Set(["field", "spellTrap", "fieldSpell"]);
    return list.every((req) => {
      if (!Array.isArray(req.candidates) || req.candidates.length === 0) {
        return false;
      }
      return req.candidates.every(
        (cand) =>
          (allowedZones.has(cand.zone) || cand.isDirectAttack === true) &&
          (cand.controller === "player" || cand.controller === "bot")
      );
    });
  }

  normalizeActivationResult(result) {
    const base =
      result && typeof result === "object" && !Array.isArray(result)
        ? result
        : {};
    const needsSelection = base.needsSelection === true;
    const success = needsSelection ? false : base.success === true;
    let selectionContract = base.selectionContract;

    if (!selectionContract && Array.isArray(base.options)) {
      selectionContract = this.convertLegacyOptionsToSelectionContract(
        base.options,
        { kind: base.selectionKind }
      );
      if (selectionContract) {
        this.devLog("SELECTION_CONTRACT_LEGACY", {
          summary: "Legacy options converted to selectionContract.",
        });
      }
    }

    return { ...base, success, needsSelection, selectionContract };
  }

  async runActivationPipeline(config = {}) {
    if (!config || typeof config.activate !== "function") return null;

    const owner = config.owner || this.player;
    let resolvedCard = config.card;
    if (!owner || !resolvedCard) return null;

    if (config.blockWhileSelecting !== false && this.targetSelection) {
      return null;
    }

    const selectionKind = config.selectionKind || "activation";
    let resolvedZone =
      config.activationZone || config.activationContext?.activationZone || null;

    const logPipeline = (tag, detail = {}) => {
      if (typeof this.devLog !== "function") return;
      const summaryBase = [
        resolvedCard?.name,
        selectionKind,
        resolvedZone || "zone",
      ]
        .filter(Boolean)
        .join(" | ");
      const summary =
        typeof detail.summary === "string" ? detail.summary : summaryBase;
      this.devLog(tag, { summary, ...detail });
    };

    if (typeof config.gate === "function") {
      const gateResult = config.gate();
      if (gateResult && gateResult.ok === false) {
        logPipeline("PIPELINE_PREVIEW_FAIL", { reason: gateResult.reason });
        if (gateResult.reason) {
          this.renderer.log(gateResult.reason);
        }
        return gateResult;
      }
    }

    if (typeof config.preview === "function") {
      const previewResult = config.preview();
      if (previewResult && previewResult.ok === false) {
        logPipeline("PIPELINE_PREVIEW_FAIL", { reason: previewResult.reason });
        if (previewResult.reason) {
          this.renderer.log(previewResult.reason);
        }
        return previewResult;
      }
      logPipeline("PIPELINE_PREVIEW_OK");
    } else {
      logPipeline("PIPELINE_PREVIEW_OK");
    }

    let commitInfo = null;
    if (typeof config.commit === "function") {
      commitInfo = config.commit();
      if (!commitInfo || !commitInfo.cardRef) {
        return null;
      }
      resolvedCard = commitInfo.cardRef;
      resolvedZone = commitInfo.activationZone || resolvedZone;
      logPipeline("PIPELINE_COMMIT", {
        activationZone: resolvedZone,
        fromIndex: commitInfo.fromIndex,
        replacedFieldSpell: commitInfo.replacedFieldSpell?.name || null,
      });
    }

    const committed = config.activationContext?.committed === true || !!commitInfo;
    const fromHand = config.activationContext?.fromHand === true || !!commitInfo;
    const resolvedActivationZone =
      resolvedZone || config.activationContext?.activationZone || null;
    const explicitAutoSelect =
      typeof config.activationContext?.autoSelectSingleTarget === "boolean"
        ? config.activationContext.autoSelectSingleTarget
        : owner === this.bot;
    const activationContext = {
      ...(config.activationContext || {}),
      fromHand,
      activationZone: resolvedActivationZone,
      sourceZone:
        config.activationContext?.sourceZone ||
        (fromHand ? "hand" : resolvedActivationZone),
      committed,
      commitInfo: config.activationContext?.commitInfo || commitInfo || null,
      autoSelectSingleTarget: explicitAutoSelect,
    };

    const safeActivate = async (selections) => {
      try {
        return await config.activate(
          selections,
          activationContext,
          resolvedActivationZone,
          resolvedCard,
          owner
        );
      } catch (err) {
        console.error("[Game] Activation pipeline error:", err);
        return {
          success: false,
          needsSelection: false,
          reason: "Resolution failed.",
        };
      }
    };

    const handleResult = async (result, fromSelection = false) => {
      const normalized = this.normalizeActivationResult(result);

      if (fromSelection) {
        logPipeline("PIPELINE_SELECTION_FINISH", {
          success: normalized.success,
          needsSelection: normalized.needsSelection,
        });
      }

      if (normalized.needsSelection) {
        let selectionContract = normalized.selectionContract;
        if (!selectionContract && Array.isArray(normalized.options)) {
          selectionContract = this.convertLegacyOptionsToSelectionContract(
            normalized.options,
            { kind: selectionKind }
          );
        }
        if (!selectionContract) {
          const selectionFailure = {
            success: false,
            needsSelection: false,
            reason: "Target selection failed.",
          };
          return handleResult(selectionFailure, true);
        }

        const allowCancel =
          activationContext.committed || config.preventCancel === true
            ? false
            : typeof config.allowCancel === "boolean"
            ? config.allowCancel
            : true;

        const normalizedContract = this.normalizeSelectionContract(
          selectionContract,
          {
            kind: selectionKind,
            message: config.selectionMessage || selectionContract.message || null,
            ui: {
              allowCancel,
              preventCancel:
                activationContext.committed || config.preventCancel === true,
              useFieldTargeting: config.useFieldTargeting,
              allowEmpty: config.allowEmpty,
            },
          }
        );

        if (!normalizedContract.ok) {
          const selectionFailure = {
            success: false,
            needsSelection: false,
            reason: normalizedContract.reason || "Target selection failed.",
          };
          return handleResult(selectionFailure, true);
        }

        const contract = normalizedContract.contract;
        if (typeof contract.ui.allowEmpty !== "boolean") {
          contract.ui.allowEmpty = contract.requirements.some(
            (req) => Number(req.min ?? 0) === 0
          );
        }
        const usingFieldTargeting =
          typeof contract.ui.useFieldTargeting === "boolean"
            ? contract.ui.useFieldTargeting
            : this.canUseFieldTargeting(contract.requirements);
        contract.ui.useFieldTargeting = usingFieldTargeting;

        if (typeof config.onSelectionStart === "function") {
          config.onSelectionStart();
        }

        logPipeline("PIPELINE_SELECTION_START", {
          mode: usingFieldTargeting ? "field" : "modal",
          committed: activationContext.committed,
          requirementCount: contract.requirements.length,
        });

        const shouldAutoSelect =
          config.useAutoSelector === true || owner === this.bot;

        if (shouldAutoSelect) {
          const autoResult = this.autoSelector?.select(contract, {
            owner,
            activationContext,
            selectionKind,
          });
          if (!autoResult?.ok) {
            const selectionFailure = {
              success: false,
              needsSelection: false,
              reason: autoResult?.reason || "Auto selection failed.",
            };
            return handleResult(selectionFailure, true);
          }
          const nextResult = await safeActivate(autoResult.selections || {});
          const normalizedNext = this.normalizeActivationResult(nextResult);
          if (normalizedNext.needsSelection) {
            const selectionFailure = {
              success: false,
              needsSelection: false,
              reason: "Auto selection failed.",
            };
            return handleResult(selectionFailure, true);
          }
          return handleResult(normalizedNext, true);
        }

        try {
          this.startTargetSelectionSession({
            kind: selectionKind,
            card: resolvedCard,
            owner,
            selectionContract: contract,
            activationZone: resolvedActivationZone,
            activationContext,
            preventCancel: contract.ui.preventCancel,
            allowCancel: contract.ui.allowCancel,
            message: contract.message,
            execute: (selections) => safeActivate(selections),
            onResult: (nextResult) => handleResult(nextResult, true),
            onCancel: allowCancel ? config.onCancel : null,
          });
        } catch (err) {
          console.error("[Game] Failed to start target selection:", err);
          if (this.targetSelection?.closeModal) {
            this.targetSelection.closeModal();
          }
          this.clearTargetHighlights();
          if (
            this.renderer &&
            typeof this.renderer.hideFieldTargetingControls === "function"
          ) {
            this.renderer.hideFieldTargetingControls();
          }
          this.targetSelection = null;
          this.setSelectionState("idle");
          const selectionFailure = {
            success: false,
            needsSelection: false,
            reason: "Target selection failed.",
          };
          return handleResult(selectionFailure, true);
        }

        return normalized;
      }

      if (!normalized.success) {
        if (normalized.reason && config.suppressFailureLog !== true) {
          this.renderer.log(normalized.reason);
        }
        if (activationContext.committed && activationContext.commitInfo) {
          this.rollbackSpellActivation(owner, activationContext.commitInfo);
          logPipeline("PIPELINE_ROLLBACK", {
            activationZone: resolvedActivationZone,
          });
        }
        if (typeof config.onFailure === "function") {
          config.onFailure(normalized, activationContext);
        }
        return normalized;
      }

      if (typeof config.finalize === "function") {
        config.finalize(normalized, {
          card: resolvedCard,
          owner,
          activationZone: resolvedActivationZone,
          activationContext,
        });
      }
      logPipeline("PIPELINE_FINALIZE", {
        activationZone: resolvedActivationZone,
      });
      if (typeof config.onSuccess === "function") {
        config.onSuccess(normalized, activationContext);
      }
      return normalized;
    };

    const initialResult = await safeActivate(config.selections || null);
    return handleResult(initialResult, false);
  }

  startTargetSelectionSession(session) {
    if (!session || !session.selectionContract) return;

    const normalizedContract = this.normalizeSelectionContract(
      session.selectionContract,
      {
        kind: session.kind,
        message: session.message,
        ui: {
          allowCancel: session.allowCancel,
          preventCancel: session.preventCancel,
          useFieldTargeting: session.useFieldTargeting,
          allowEmpty: session.allowEmpty,
        },
      }
    );

    if (!normalizedContract.ok) {
      console.warn("[Game] Invalid selection contract:", normalizedContract);
      return;
    }

    const selectionContract = normalizedContract.contract;

    this.cancelTargetSelection();
    if (this.targetSelection) {
      return;
    }

    const usingFieldTargeting =
      typeof selectionContract.ui.useFieldTargeting === "boolean"
        ? selectionContract.ui.useFieldTargeting
        : this.canUseFieldTargeting(selectionContract.requirements);
    selectionContract.ui.useFieldTargeting = usingFieldTargeting;

    this.targetSelection = {
      ...session,
      selectionContract,
      requirements: selectionContract.requirements,
      selections: {},
      currentRequirement: 0,
      usingFieldTargeting,
      allowCancel: selectionContract.ui.allowCancel !== false,
      allowEmpty: selectionContract.ui.allowEmpty === true,
      autoAdvanceOnMax:
        typeof session.autoAdvanceOnMax === "boolean"
          ? session.autoAdvanceOnMax
          : !usingFieldTargeting,
    };
    this.setSelectionState("selecting");

    if (usingFieldTargeting) {
      if (
        this.renderer &&
        typeof this.renderer.showFieldTargetingControls === "function"
      ) {
        const allowCancel =
          this.targetSelection.allowCancel !== false &&
          !this.targetSelection.preventCancel;
        this.renderer.showFieldTargetingControls(
          () => this.advanceTargetSelection(),
          allowCancel ? () => this.cancelTargetSelection() : null,
          { allowCancel }
        );
      }
    } else if (
      this.renderer &&
      typeof this.renderer.showTargetSelection === "function"
    ) {
      const allowCancel =
        this.targetSelection.allowCancel !== false &&
        !this.targetSelection.preventCancel;
      const modalHandle = this.renderer.showTargetSelection(
        selectionContract,
        (chosenMap) => {
          if (!this.targetSelection) return;
          this.setSelectionState("confirming");
          this.targetSelection.selections = chosenMap || {};
          this.targetSelection.currentRequirement =
            this.targetSelection.requirements.length;
          this.finishTargetSelection();
        },
        allowCancel ? () => this.cancelTargetSelection() : null,
        {
          allowCancel,
          allowEmpty: this.targetSelection.allowEmpty === true,
        }
      );
      if (modalHandle && typeof modalHandle.close === "function") {
        this.targetSelection.closeModal = modalHandle.close;
      }
    }

    if (selectionContract.message) {
      this.renderer.log(selectionContract.message);
    }
    if (usingFieldTargeting) {
      this.highlightTargetCandidates();
    }
  }

  activateFieldSpellEffect(card) {
    const owner = card.owner === "player" ? this.player : this.bot;
    const activationContext = {
      fromHand: false,
      activationZone: "fieldSpell",
      sourceZone: "fieldSpell",
      committed: false,
    };
    this.runActivationPipeline({
      card,
      owner,
      activationZone: "fieldSpell",
      activationContext,
      selectionKind: "fieldSpell",
      selectionMessage: "Select target(s) for the field spell effect.",
      activate: (selections, ctx) =>
        this.effectEngine.activateFieldSpell(card, owner, selections, ctx),
      finalize: () => {
        this.renderer.log(`${card.name} field effect activated.`);
        this.updateBoard();
      },
    });
  }

  startAttackTargetSelection(attacker, candidates) {
    if (!attacker || !Array.isArray(candidates)) return;
    if (candidates.length === 0 && !attacker.canAttackDirectlyThisTurn) return;
    const decorated = candidates.map((card, idx) => {
      const ownerLabel = card.owner === "player" ? "player" : "opponent";
      const ownerPlayer = card.owner === "player" ? this.player : this.bot;
      const zoneArr = this.getZone(ownerPlayer, "field") || [];
      const zoneIndex = zoneArr.indexOf(card);
      const candidate = {
        idx,
        name: card.name,
        owner: ownerLabel,
        controller: card.owner,
        zone: "field",
        zoneIndex,
        position: card.position,
        atk: card.atk,
        def: card.def,
        cardKind: card.cardKind,
        cardRef: card,
      };
      candidate.key = this.buildSelectionCandidateKey(candidate, idx);
      return candidate;
    });

    // Adiciona alvo de ataque direto (clicar na mão do oponente) quando permitido
    if (attacker.canAttackDirectlyThisTurn) {
      decorated.push({
        idx: decorated.length,
        name: "Direct Attack",
        owner: "opponent",
        controller: this.bot.id,
        zone: "hand",
        zoneIndex: -1,
        position: "attack",
        atk: 0,
        def: 0,
        cardKind: "direct",
        cardRef: null,
        isDirectAttack: true,
        key: this.buildSelectionCandidateKey(
          {
            controller: this.bot.id,
            zone: "hand",
            zoneIndex: -1,
            name: "Direct Attack",
          },
          decorated.length
        ),
      });
    }

    const requirement = {
      id: "attack_target",
      min: 1,
      max: 1,
      zones: [...new Set(decorated.map((cand) => cand.zone).filter(Boolean))],
      owner: "opponent",
      filters: {},
      allowSelf: true,
      distinct: true,
      candidates: decorated,
    };
    const selectionContract = {
      kind: "choice",
      message: "Select a monster to attack.",
      requirements: [requirement],
      ui: { useFieldTargeting: true },
      metadata: { context: "attack" },
    };

    this.startTargetSelectionSession({
      kind: "attack",
      attacker,
      selectionContract,
      execute: (selections) => {
        const chosenKeys = selections[requirement.id] || [];
        const chosenKey = chosenKeys[0];
        const chosenCandidate = requirement.candidates.find(
          (cand) => cand.key === chosenKey
        );
        if (chosenCandidate?.isDirectAttack) {
          this.resolveCombat(attacker, null).catch((err) =>
            console.error(err)
          );
        } else if (chosenCandidate?.cardRef) {
          this.resolveCombat(attacker, chosenCandidate.cardRef).catch((err) =>
            console.error(err)
          );
        }
        return { success: true, needsSelection: false };
      },
    });
  }

  askPlayerToSelectCards(config = {}) {
    const owner = config.owner === "player" ? this.player : null;
    if (!owner) return Promise.resolve([]);

    const zoneName = config.zone || "field";
    let candidates = this.getZone(owner, zoneName) || [];

    const filter = config.filter;
    if (filter) {
      if (typeof filter === "function") {
        candidates = candidates.filter(filter);
      } else if (typeof filter === "object") {
        candidates = candidates.filter((card) => {
          return Object.entries(filter).every(([key, value]) => {
            if (!card) return false;
            if (Array.isArray(value)) {
              return value.includes(card[key]);
            }
            return card[key] === value;
          });
        });
      }
    }

    const min = Math.max(1, config.min ?? 1);
    const max = Math.min(config.max ?? min, candidates.length);

    if (candidates.length < min) {
      return Promise.resolve([]);
    }

    const decorated = candidates.map((card, idx) => {
      const ownerLabel = card.owner === "player" ? "player" : "opponent";
      const ownerPlayer = card.owner === "player" ? this.player : this.bot;
      const zoneArr = this.getZone(ownerPlayer, zoneName) || [];
      const zoneIndex = zoneArr.indexOf(card);
      return {
        idx,
        name: card.name,
        owner: ownerLabel,
        controller: card.owner,
        zone: zoneName,
        zoneIndex,
        position: card.position,
        atk: card.atk,
        def: card.def,
        cardKind: card.cardKind,
        cardRef: card,
      };
    });

    return new Promise((resolve) => {
      const candidatesWithKeys = decorated.map((cand, idx) => {
        if (!cand.key) {
          cand.key = this.buildSelectionCandidateKey(cand, idx);
        }
        return cand;
      });
      const requirement = {
        id: "custom_select",
        min,
        max,
        zones: [zoneName],
        owner: "player",
        filters: {},
        allowSelf: true,
        distinct: true,
        candidates: candidatesWithKeys,
      };
      const selectionContract = {
        kind: "choice",
        message:
          config.message ||
          "Select card(s) by clicking the highlighted targets.",
        requirements: [requirement],
        ui: { useFieldTargeting: true },
        metadata: { context: "custom" },
      };

      this.startTargetSelectionSession({
        kind: "custom",
        selectionContract,
        resolve,
        execute: (selections) => {
          const chosenKeys = selections[requirement.id] || [];
          const chosen = chosenKeys
            .map((key) =>
              requirement.candidates.find((cand) => cand.key === key)
            )
            .map((cand) => cand?.cardRef)
            .filter(Boolean);
          resolve(chosen);
          return { success: true, needsSelection: false };
        },
      });
    });
  }

  highlightTargetCandidates() {
    this.clearTargetHighlights();
    if (!this.targetSelection) {
      console.log("[Game] No target selection active");
      return;
    }
    if (!this.targetSelection.usingFieldTargeting) {
      return;
    }
    if (this.targetSelection.state && this.targetSelection.state !== "selecting") {
      return;
    }
    const requirement =
      this.targetSelection.requirements[
        this.targetSelection.currentRequirement
      ];
    if (!requirement) {
      console.log("[Game] No option to highlight");
      return;
    }

    console.log("[Game] Highlighting targets:", {
      kind: this.targetSelection.kind,
      optionId: requirement.id,
      candidatesCount: requirement.candidates?.length,
      min: requirement.min,
      max: requirement.max,
    });

    requirement.candidates.forEach((cand) => {
      let targetEl = null;
      if (cand.isDirectAttack) {
        targetEl = document.querySelector("#bot-hand");
      } else if (cand.zone === "field") {
        const fieldSelector =
          cand.controller === "player" ? "#player-field" : "#bot-field";
        const indexSelector = ` .card[data-index="${cand.zoneIndex}"]`;
        targetEl = document.querySelector(`${fieldSelector}${indexSelector}`);
        console.log("[Game] Highlighting field card:", {
          controller: cand.controller,
          index: cand.zoneIndex,
          name: cand.name,
          found: !!targetEl,
        });
      } else if (cand.zone === "spellTrap") {
        const stSelector =
          cand.controller === "player" ? "#player-spelltrap" : "#bot-spelltrap";
        const indexSelector = ` .card[data-index="${cand.zoneIndex}"]`;
        targetEl = document.querySelector(`${stSelector}${indexSelector}`);
        console.log("[Game] Highlighting spell/trap card:", {
          controller: cand.controller,
          index: cand.zoneIndex,
          name: cand.name,
          found: !!targetEl,
        });
      } else if (cand.zone === "fieldSpell") {
        const fieldSelector =
          cand.controller === "player"
            ? "#player-fieldspell"
            : "#bot-fieldspell";
        targetEl = document.querySelector(`${fieldSelector} .card`);
      }

      if (!targetEl) {
        console.log("[Game] Target element not found for:", cand);
        return;
      }

      targetEl.classList.add("targetable");
      if (cand.isDirectAttack) {
        targetEl.style.pointerEvents = "auto";
        targetEl.classList.add("direct-attack-target");
      }
      const selected = this.targetSelection.selections[requirement.id] || [];
      if (selected.includes(cand.key)) {
        targetEl.classList.add("selected-target");
      }
    });
  }

  clearTargetHighlights() {
    document
      .querySelectorAll(".card.targetable")
      .forEach((el) => el.classList.remove("targetable"));
    document
      .querySelectorAll(".card.selected-target")
      .forEach((el) => el.classList.remove("selected-target"));
    const botHand = document.querySelector("#bot-hand");
    if (botHand) {
      botHand.style.pointerEvents = "";
      botHand.classList.remove(
        "targetable",
        "selected-target",
        "direct-attack-target"
      );
    }
  }

  handleTargetSelectionClick(ownerId, cardIndex, cardEl, location = null) {
    if (!this.targetSelection) return false;
    if (!this.targetSelection.usingFieldTargeting) return false;
    if (this.targetSelection.state && this.targetSelection.state !== "selecting") {
      return false;
    }

    console.log("[Game] Target selection click:", {
      ownerId,
      cardIndex,
      currentRequirement: this.targetSelection.currentRequirement,
      requirementsLength: this.targetSelection.requirements?.length,
    });

    const requirement =
      this.targetSelection.requirements[
        this.targetSelection.currentRequirement
      ];
    if (!requirement) {
      console.log("[Game] No option found");
      return false;
    }

    const ownerPlayer = ownerId === "player" ? this.player : this.bot;
    let card = null;
    const zoneHint = location || requirement.zones?.[0] || "field";

    if (zoneHint === "fieldSpell") {
      card = ownerPlayer.fieldSpell;
    } else if (zoneHint === "spellTrap") {
      card = ownerPlayer.spellTrap[cardIndex];
    } else {
      card = ownerPlayer.field[cardIndex];
    }

    if (!card) {
      console.log("[Game] Card not found at index:", cardIndex);
      return true;
    }

    console.log("[Game] Looking for candidate:", {
      cardName: card.name,
      cardIndex: cardIndex,
      candidatesCount: requirement.candidates.length,
      candidateNames: requirement.candidates.map(
        (c) => `${c.name} [idx:${c.zoneIndex}]`
      ),
    });

    // Find candidate by matching card reference (most reliable method)
    // NOTE: We use cardRef identity match instead of zoneIndex because
    // zoneIndex can become stale if the board is re-rendered between
    // when decoratedCandidates were created and when the click occurs
    const candidate = requirement.candidates.find(
      (cand) => cand.cardRef === card
    );

    if (!candidate) {
      console.log("[Game] Candidate not found. Checking references:");
      requirement.candidates.forEach((cand, i) => {
        console.log(`  Candidate ${i}:`, {
          name: cand.name,
          zoneIndex: cand.zoneIndex,
          cardIndex: cardIndex,
          refMatch: cand.cardRef === card,
        });
      });
      return true;
    }

    const selections = this.targetSelection.selections[requirement.id] || [];
    const max = Number(requirement.max ?? 0);
    const existing = selections.indexOf(candidate.key);
    if (existing > -1) {
      selections.splice(existing, 1);
      cardEl.classList.remove("selected-target");
      console.log("[Game] Deselected card");
    } else {
      if (max > 0 && selections.length >= max) {
        console.log("[Game] Max selections reached");
        return true;
      }
      selections.push(candidate.key);
      cardEl.classList.add("selected-target");
      console.log(
        "[Game] Selected card, total:",
        selections.length,
        "/",
        max || requirement.max
      );
    }
    this.targetSelection.selections[requirement.id] = selections;

    const shouldAutoAdvance = this.targetSelection.autoAdvanceOnMax !== false;

    if (shouldAutoAdvance && max > 0 && selections.length >= max) {
      console.log("[Game] Max reached, advancing selection");
      this.advanceTargetSelection();
    }

    return true;
  }

  advanceTargetSelection() {
    if (!this.targetSelection) return;
    if (this.targetSelection.state && this.targetSelection.state !== "selecting") {
      return;
    }
    const requirement =
      this.targetSelection.requirements[
        this.targetSelection.currentRequirement
      ];
    if (!requirement) return;

    const selections = this.targetSelection.selections[requirement.id] || [];
    if (selections.length < requirement.min) {
      return;
    }

    this.targetSelection.currentRequirement++;
    if (
      this.targetSelection.currentRequirement >=
      this.targetSelection.requirements.length
    ) {
      this.setSelectionState("confirming");
      this.finishTargetSelection();
    } else {
      this.highlightTargetCandidates();
    }
  }

  async finishTargetSelection() {
    if (!this.targetSelection) return;
    const selection = this.targetSelection;
    this.setSelectionState("resolving");
    this.targetSelection = null;
    this.graveyardSelection = null;
    this.clearTargetHighlights();
    if (
      this.renderer &&
      typeof this.renderer.hideFieldTargetingControls === "function"
    ) {
      this.renderer.hideFieldTargetingControls();
    }
    if (selection?.closeModal) {
      selection.closeModal();
    }

    let normalized = {
      success: false,
      needsSelection: false,
      reason: "Selection failed.",
    };

    try {
      if (typeof selection.execute !== "function") {
        console.warn("[Game] Selection missing execute handler:", selection);
      } else {
        const result = await selection.execute(selection.selections || {});
        normalized = this.normalizeActivationResult(result);
      }

      if (
        selection.rollback &&
        selection.activationContext?.committed === true &&
        !normalized.needsSelection &&
        !normalized.success
      ) {
        try {
          selection.rollback();
        } catch (err) {
          console.error("[Game] Rollback failed:", err);
        }
      }

      if (typeof selection.onResult === "function") {
        selection.onResult(normalized);
      }
    } catch (err) {
      console.error("[Game] Error resolving selection:", err);
    } finally {
      if (!this.targetSelection) {
        this.setSelectionState("idle");
      }
    }
  }

  setSelectionState(state) {
    this.selectionState = state;
    if (this.targetSelection) {
      this.targetSelection.state = state;
    }
  }

  cancelTargetSelection() {
    if (!this.targetSelection) return;
    if (this.targetSelection.preventCancel) {
      return;
    }
    const selection = this.targetSelection;
    if (typeof selection.onCancel === "function") {
      selection.onCancel();
    }
    if (selection?.resolve) {
      selection.resolve([]);
    }
    this.clearTargetHighlights();
    if (
      this.renderer &&
      typeof this.renderer.hideFieldTargetingControls === "function"
    ) {
      this.renderer.hideFieldTargetingControls();
    }
    if (selection?.closeModal) {
      selection.closeModal();
    }
    this.targetSelection = null;
    this.setSelectionState("idle");
  }
  openGraveyardModal(player, options = {}) {
    if (options.selectable) {
      this.graveyardSelection = { onCancel: options.onCancel || null };
    } else {
      this.graveyardSelection = null;
    }

    // Se não está em modo de seleção, mostrar indicador de efeitos ativáveis
    if (
      !options.selectable &&
      player.id === "player" &&
      this.turn === "player"
    ) {
      options.showActivatable = true;
      options.isActivatable = (card) => {
        return this.effectEngine.hasActivatableGraveyardEffect(card);
      };

      // Se não tem onSelect customizado, usar o padrão para ativar efeitos
      if (!options.onSelect) {
        options.onSelect = (card) => {
          if (!this.effectEngine.hasActivatableGraveyardEffect(card)) {
            return;
          }
          const activationContext = {
            fromHand: false,
            activationZone: "graveyard",
            sourceZone: "graveyard",
            committed: false,
          };
          this.runActivationPipeline({
            card,
            owner: player,
            activationZone: "graveyard",
            activationContext,
            selectionKind: "graveyardEffect",
            selectionMessage: "Select target(s) for the graveyard effect.",
            onSelectionStart: () => this.closeGraveyardModal(false),
            activate: (chosen, ctx) =>
              this.effectEngine.activateMonsterFromGraveyard(
                card,
                player,
                chosen,
                ctx
              ),
            finalize: () => {
              this.closeGraveyardModal(false);
              this.renderer.log(`${card.name} activates from the Graveyard.`);
              this.updateBoard();
            },
          });
        };
        options.selectable = true;
      }
    }

    this.renderer.renderGraveyardModal(player.graveyard, options);
    this.renderer.toggleModal(true);
  }

  closeGraveyardModal(triggerCancel = true) {
    this.renderer.toggleModal(false);
    if (triggerCancel && this.graveyardSelection?.onCancel) {
      this.graveyardSelection.onCancel();
    }
    this.graveyardSelection = null;
  }

  openExtraDeckModal(player) {
    this.renderer.renderExtraDeckModal(player.extraDeck);
    this.renderer.toggleExtraDeckModal(true);
  }

  closeExtraDeckModal() {
    this.renderer.toggleExtraDeckModal(false);
  }

  promptTransmutateRevive(player, level) {
    const filter = (card) =>
      card.cardKind === "monster" && (card.level || 0) === level;
    if (!player.graveyard.some(filter)) {
      alert("No monster with a matching Level in your Graveyard.");
      return;
    }

    const levelLabel = level > 0 ? "Level " + level : "matching";

    this.openGraveyardModal(player, {
      selectable: true,
      filterMessage: "Select a " + levelLabel + " monster to Special Summon.",
      isDisabled: (card) => !filter(card),
      onSelect: (card, index) => {
        if (!filter(card)) return;
        if (player.field.length >= 5) {
          alert("Field is full.");
          this.closeGraveyardModal(false);
          return;
        }
        const finalizeRevive = (posChoice) => {
          const position = posChoice || "attack";
          const gyIndex = player.graveyard.indexOf(card);
          if (gyIndex === -1) {
            this.renderer.log("Selected card is no longer in the Graveyard.");
            this.closeGraveyardModal(false);
            this.updateBoard();
            return;
          }

          player.graveyard.splice(gyIndex, 1);
          card.position = position;
          card.isFacedown = false;
          card.hasAttacked = false;
          card.attacksUsedThisTurn = 0;
          card.owner = player.id;
          player.field.push(card);
          this.closeGraveyardModal(false);
          this.updateBoard();
        };

        const positionChoice = this.chooseSpecialSummonPosition(player, card);
        if (positionChoice && typeof positionChoice.then === "function") {
          positionChoice.then((pos) => finalizeRevive(pos));
        } else {
          finalizeRevive(positionChoice);
        }
      },
      onCancel: () => {
        this.renderer.log("Transmutate selection cancelled.");
      },
    });
  }

  getAttackAvailability(attacker) {
    if (!attacker) {
      return { ok: false, reason: "No attacker selected." };
    }
    if (attacker.cannotAttackThisTurn) {
      return {
        ok: false,
        reason: `${attacker.name} cannot attack this turn.`,
      };
    }
    if (attacker.position === "defense") {
      return {
        ok: false,
        reason: "Defense position monsters cannot attack!",
      };
    }

    const extraAttacks = attacker.extraAttacks || 0;
    const maxAttacks = 1 + extraAttacks;
    const attacksUsed = attacker.attacksUsedThisTurn || 0;
    const canUseSecondAttack =
      attacker.canMakeSecondAttackThisTurn &&
      !attacker.secondAttackUsedThisTurn;

    if (attacksUsed >= maxAttacks && !canUseSecondAttack) {
      return {
        ok: false,
        reason: `${attacker.name} has already attacked the maximum number of times this turn.`,
      };
    }

    return { ok: true, maxAttacks, attacksUsed };
  }

  markAttackUsed(attacker) {
    if (!attacker) return;
    const extraAttacks = attacker.extraAttacks || 0;
    const maxAttacks = 1 + extraAttacks;
    attacker.attacksUsedThisTurn = (attacker.attacksUsedThisTurn || 0) + 1;
    if (
      attacker.attacksUsedThisTurn > maxAttacks &&
      attacker.canMakeSecondAttackThisTurn &&
      !attacker.secondAttackUsedThisTurn
    ) {
      attacker.secondAttackUsedThisTurn = true;
    }
    if (attacker.attacksUsedThisTurn >= maxAttacks) {
      attacker.hasAttacked = true;
    } else {
      attacker.hasAttacked = false;
    }
  }

  registerAttackNegated(attacker) {
    this.lastAttackNegated = true;
    if (attacker?.name) {
      this.renderer.log(`The attack of ${attacker.name} was negated!`);
    } else {
      this.renderer.log("The attack was negated!");
    }
  }

  canDestroyByBattle(card) {
    if (!card) return false;
    if (card.battleIndestructible) return false;
    if (card.tempBattleIndestructible) return false;
    if (
      card.battleIndestructibleOncePerTurn &&
      !card.battleIndestructibleOncePerTurnUsed
    ) {
      card.battleIndestructibleOncePerTurnUsed = true;
      return false;
    }
    return true;
  }

  async resolveCombat(attacker, target) {
    if (!attacker) return;

    const availability = this.getAttackAvailability(attacker);
    if (!availability.ok) return;

    const attacksUsed =
      availability.attacksUsed ?? attacker.attacksUsedThisTurn ?? 0;
    const baseMaxAttacks = 1 + (attacker.extraAttacks || 0);
    const maxAttacks = availability.maxAttacks ?? baseMaxAttacks;
    const usingSecondAttack =
      attacker.canMakeSecondAttackThisTurn &&
      !attacker.secondAttackUsedThisTurn &&
      attacksUsed >= maxAttacks;

    if (usingSecondAttack) {
      attacker.secondAttackUsedThisTurn = true;
    }

    this.lastAttackNegated = false;

    this.renderer.log(
      `${attacker.name} attacks ${target ? target.name : "directly"}!`
    );

    const attackerOwner = attacker.owner === "player" ? this.player : this.bot;
    const defenderOwner = attacker.owner === "player" ? this.bot : this.player;

    await this.emit("attack_declared", {
      attacker,
      target: target || null,
      defender: target || null,
      attackerOwner,
      defenderOwner,
    });

    // Verificar traps do player apenas quando ele está defendendo
    if (defenderOwner === this.player) {
      await this.checkAndOfferTraps("attack_declared", {
        isOpponentAttack: attackerOwner === this.bot,
        attacker,
        target,
        attackerOwner,
        defenderOwner,
      });
    }

    if (this.lastAttackNegated) {
      attacker.attacksUsedThisTurn = (attacker.attacksUsedThisTurn || 0) + 1;
      attacker.hasAttacked = true;
      this.updateBoard();
      this.checkWinCondition();
      return;
    }

    if (!target) {
      const defender = attacker.owner === "player" ? this.bot : this.player;
      defender.takeDamage(attacker.atk);
      this.markAttackUsed(attacker);
      this.checkWinCondition();
      this.updateBoard();
    } else {
      const needsFlip = target.isFacedown;

      if (needsFlip) {
        const targetOwner = target.owner === "player" ? "player" : "bot";
        const targetField =
          target.owner === "player" ? this.player.field : this.bot.field;
        const targetIndex = targetField.indexOf(target);

        const cardElement = document.querySelector(
          `#${targetOwner}-field .card[data-index="${targetIndex}"]`
        );

        if (cardElement) {
          cardElement.classList.add("flipping");
        }

        target.isFacedown = false;
        this.renderer.log(`${target.name} was flipped!`);

        this.updateBoard();

        setTimeout(() => {
          this.finishCombat(attacker, target).catch((err) =>
            console.error(err)
          );
        }, 600);

        return;
      }

      this.finishCombat(attacker, target).catch((err) => console.error(err));
    }
  }

  async finishCombat(attacker, target) {
    const applyBattleDamage = (player, cardInvolved, amount) => {
      if (!player || amount <= 0) return;
      if (
        cardInvolved?.battleDamageHealsControllerThisTurn &&
        player.id === cardInvolved.owner
      ) {
        player.gainLP(amount);
      } else {
        player.takeDamage(amount);
      }
    };

    const logBattleDestroyCheck = (context) => {
      const formatCard = (card, label) => {
        if (!card) return `${label}: (none)`;
        const flags = `bi=${!!card.battleIndestructible}, tempBi=${!!card.tempBattleIndestructible}, once=${!!card.battleIndestructibleOncePerTurn}, onceUsed=${!!card.battleIndestructibleOncePerTurnUsed}`;
        return `${label}: ${card.name} ATK:${card.atk} DEF:${card.def} ${flags}`;
      };
      console.debug(
        `[Battle] canDestroyByBattle check (${context}) | ${formatCard(
          attacker,
          "attacker"
        )} | ${formatCard(target, "target")}`
      );
    };

    if (target.position === "attack") {
      if (attacker.atk > target.atk) {
        const defender = target.owner === "player" ? this.player : this.bot;
        const damage = attacker.atk - target.atk;
        applyBattleDamage(defender, target, damage);

        logBattleDestroyCheck("attacker over atk target");
        if (this.canDestroyByBattle(target)) {
          const result = await this.destroyCard(target, {
            cause: "battle",
            sourceCard: attacker,
          });
          if (result?.destroyed) {
            this.applyBattleDestroyEffect(attacker, target);
          }
        }
      } else if (attacker.atk < target.atk) {
        const attPlayer = attacker.owner === "player" ? this.player : this.bot;
        const damage = target.atk - attacker.atk;
        applyBattleDamage(attPlayer, attacker, damage);

        logBattleDestroyCheck("attacker loses to atk target");
        if (this.canDestroyByBattle(attacker)) {
          const result = await this.destroyCard(attacker, {
            cause: "battle",
            sourceCard: target,
          });
          if (result?.destroyed) {
            this.applyBattleDestroyEffect(attacker, attacker);
          }
        }
      } else {
        logBattleDestroyCheck("tie - attacker destruction check");
        if (this.canDestroyByBattle(attacker)) {
          const result = await this.destroyCard(attacker, {
            cause: "battle",
            sourceCard: target,
          });
          if (result?.destroyed) {
            this.applyBattleDestroyEffect(attacker, attacker);
          }
        }

        logBattleDestroyCheck("tie - target destruction check");
        if (this.canDestroyByBattle(target)) {
          const result = await this.destroyCard(target, {
            cause: "battle",
            sourceCard: attacker,
          });
          if (result?.destroyed) {
            this.applyBattleDestroyEffect(attacker, target);
          }
        }
      }
    } else {
      const defender = target.owner === "player" ? this.player : this.bot;
      if (attacker.atk > target.def) {
        if (attacker.piercing) {
          const damage = attacker.atk - target.def;
          applyBattleDamage(defender, target, damage);
        }
        logBattleDestroyCheck("defense target destruction check");
        if (this.canDestroyByBattle(target)) {
          const result = await this.destroyCard(target, {
            cause: "battle",
            sourceCard: attacker,
          });
          if (result?.destroyed) {
            this.applyBattleDestroyEffect(attacker, target);
          }
        }
      } else if (attacker.atk < target.def) {
        const attPlayer = attacker.owner === "player" ? this.player : this.bot;
        const damage = target.def - attacker.atk;
        applyBattleDamage(attPlayer, attacker, damage);
      }
    }

    this.markAttackUsed(attacker);
    this.checkWinCondition();
    this.updateBoard();
  }

  performFusionSummon(
    materials,
    fusionMonsterIndex,
    position = "attack",
    requiredSubset = null,
    player = null
  ) {
    // Usa o jogador passado ou default para this.player
    const activePlayer = player || this.player;

    // Validate inputs
    if (!materials || materials.length === 0) {
      this.renderer.log("No materials selected for Fusion Summon.");
      return false;
    }

    const fusionMonster = activePlayer.extraDeck[fusionMonsterIndex];
    if (!fusionMonster) {
      this.renderer.log("Fusion Monster not found in Extra Deck.");
      return false;
    }

    // Check field space
    if (activePlayer.field.length >= 5) {
      this.renderer.log("Field is full (max 5 monsters).");
      return false;
    }

    const requiredMaterials =
      requiredSubset && requiredSubset.length ? requiredSubset : materials;
    const requiredSet = new Set(requiredMaterials);
    const extraMaterials = materials.filter((mat) => !requiredSet.has(mat));

    // Send materials to GY
    materials.forEach((material) => {
      this.moveCard(material, activePlayer, "graveyard");
    });

    // Remove fusion monster from Extra Deck
    activePlayer.extraDeck.splice(fusionMonsterIndex, 1);

    // Add to field
    fusionMonster.position = position;
    fusionMonster.isFacedown = false;
    fusionMonster.hasAttacked = false;
    fusionMonster.cannotAttackThisTurn = false;
    fusionMonster.owner = activePlayer.id;
    fusionMonster.summonedTurn = this.turnCounter;
    activePlayer.field.push(fusionMonster);

    const requiredNames = requiredMaterials.map((c) => c.name).join(", ");
    const extraNames = extraMaterials.map((c) => c.name).join(", ");
    const extraNote =
      extraMaterials.length > 0
        ? ` Extra materials also sent to GY: ${extraNames}.`
        : "";

    this.renderer.log(
      `Fusion Summoned ${fusionMonster.name} using ${
        requiredNames || "selected materials"
      }.${extraNote}`
    );

    // Emit after_summon event
    this.emit("after_summon", {
      card: fusionMonster,
      player: activePlayer,
      method: "fusion",
      fromZone: "extraDeck",
    });

    this.updateBoard();
    return true;
  }

  performSpecialSummon(handIndex, position) {
    const card = this.player.hand[handIndex];
    if (!card) return;

    // Remove from hand
    this.player.hand.splice(handIndex, 1);

    // Add to field
    const isFacedown = position === "defense";
    card.position = position;
    card.isFacedown = false;
    card.hasAttacked = false;
    card.cannotAttackThisTurn = true; // Cannot attack this turn (from Eel effect)
    card.owner = "player";
    this.player.field.push(card);

    this.renderer.log(`Special Summoned ${card.name} from hand.`);

    // Clear pending special summon and unlock actions
    this.pendingSpecialSummon = null;
    this.isResolvingEffect = false;

    // Remove highlight from all hand cards
    const handCards = document.querySelectorAll("#player-hand .card");
    handCards.forEach((cardEl) => {
      cardEl.classList.remove("targetable");
    });

    // Emit after_summon for special summons performed directly from hand
    this.emit("after_summon", {
      card,
      player: this.player,
      opponent: this.bot,
      method: "special",
      fromZone: "hand",
    });

    this.updateBoard();
  }

  canActivatePolymerization() {
    // Check if player has Extra Deck with Fusion Monsters
    if (!this.player.extraDeck || this.player.extraDeck.length === 0) {
      return false;
    }

    // Check field space
    if (this.player.field.length >= 5) {
      return false;
    }

    // Get available materials (hand + field)
    const availableMaterials = [
      ...(this.player.hand || []),
      ...(this.player.field || []),
    ].filter((card) => card && card.cardKind === "monster");

    if (availableMaterials.length === 0) {
      return false;
    }

    // Check if at least one Fusion Monster can be summoned
    for (const fusion of this.player.extraDeck) {
      if (
        this.effectEngine.canSummonFusion(
          fusion,
          availableMaterials,
          this.player
        )
      ) {
        return true;
      }
    }

    return false;
  }

  highlightReadySpecialSummon() {
    // Find and highlight the card ready for special summon in hand
    if (!this.pendingSpecialSummon) return;

    const handCards = document.querySelectorAll("#player-hand .card");
    handCards.forEach((cardEl, index) => {
      const card = this.player.hand[index];
      if (card && card.name === this.pendingSpecialSummon.cardName) {
        cardEl.classList.add("targetable");
      } else {
        cardEl.classList.remove("targetable");
      }
    });
  }

  checkWinCondition() {
    if (this.player.lp <= 0) {
      alert("Game Over! You Lost.");
      this.gameOver = true;
    } else if (this.bot.lp <= 0) {
      alert("Victory! You Won.");
      this.gameOver = true;
    }
  }

  getOpponent(player) {
    return player.id === "player" ? this.bot : this.player;
  }

  cleanupTempBoosts(player) {
    player.field.forEach((card) => {
      if (card.tempAtkBoost) {
        card.atk -= card.tempAtkBoost;
        if (card.atk < 0) card.atk = 0;
        card.tempAtkBoost = 0;
      }
      if (card.tempDefBoost) {
        card.def -= card.tempDefBoost;
        if (card.def < 0) card.def = 0;
        card.tempDefBoost = 0;
      }

      // Restore stats if they were set to zero
      if (card.originalAtk != null) {
        card.atk = card.originalAtk;
        card.originalAtk = null;
      }
      if (card.originalDef != null) {
        card.def = card.originalDef;
        card.originalDef = null;
      }

      // Remove effect negation
      card.effectsNegated = false;

      card.tempBattleIndestructible = false;
      card.battleDamageHealsControllerThisTurn = false;
      card.canAttackDirectlyThisTurn = false;
    });
  }

  getZone(player, zone) {
    switch (zone) {
      case "hand":
        return player.hand;
      case "deck":
        return player.deck;
      case "extraDeck":
        return player.extraDeck;
      case "spellTrap":
        return player.spellTrap;
      case "graveyard":
        return player.graveyard;
      case "fieldSpell":
        return player.fieldSpell ? [player.fieldSpell] : [];
      case "field":
      default:
        return player.field;
    }
  }

  moveCard(card, destPlayer, toZone, options = {}) {
    if (!card || !destPlayer || !toZone) return;

    const destArr = this.getZone(destPlayer, toZone);
    if (!destArr) {
      console.warn("moveCard: destination zone not found", toZone);
      return;
    }

    if (toZone === "field" && destArr.length >= 5) {
      this.renderer.log("Field is full (max 5 cards).");
      return;
    }
    if (toZone === "spellTrap" && destArr.length >= 5) {
      this.renderer.log("Spell/Trap zone is full (max 5 cards).");
      return;
    }

    const zones = [
      "field",
      "hand",
      "deck",
      "graveyard",
      "spellTrap",
      "fieldSpell",
      "extraDeck",
    ];
    const fromOwner = card.owner === this.player.id ? this.player : this.bot;
    let fromZone = null;

    for (const zoneName of zones) {
      if (zoneName === "fieldSpell" && fromOwner.fieldSpell === card) {
        fromOwner.fieldSpell = null;
        fromZone = zoneName;
        break;
      }

      const arr = this.getZone(fromOwner, zoneName) || [];
      const idx = arr.indexOf(card);
      if (idx > -1) {
        arr.splice(idx, 1);
        fromZone = zoneName;
        break;
      }
    }

    if (fromZone === "field" && card.cardKind === "monster") {
      card.summonedTurn = null;
      card.setTurn = null;
      card.positionChangedThisTurn = false;
      card.cannotAttackThisTurn = false;
      card.cannotAttackUntilTurn = null;
      card.immuneToOpponentEffectsUntilTurn = null;

      // Clean up temporary stat modifiers from effects (e.g., Shadow-Heart Coward debuff)
      if (card.tempAtkBoost) {
        card.atk -= card.tempAtkBoost;
        if (card.atk < 0) card.atk = 0;
        card.tempAtkBoost = 0;
      }
      if (card.tempDefBoost) {
        card.def -= card.tempDefBoost;
        if (card.def < 0) card.def = 0;
        card.tempDefBoost = 0;
      }
      this.effectEngine?.clearPassiveBuffsForCard(card);
    }

    // Se um equip spell está saindo da spell/trap zone, limpar seus efeitos no monstro
    if (
      fromZone === "spellTrap" &&
      card.cardKind === "spell" &&
      card.subtype === "equip" &&
      card.equippedTo
    ) {
      const host = card.equippedTo;

      // Verificar se é "The Shadow Heart" - se sair do campo, destruir o monstro equipado
      if (card.name === "The Shadow Heart" && host) {
        const hostOwner = host.owner === "player" ? this.player : this.bot;
        void this.destroyCard(host, {
          cause: "effect",
          sourceCard: card,
          opponent: this.getOpponent(hostOwner),
        }).then((result) => {
          if (result?.destroyed) {
            this.renderer.log(
              `${host.name} is destroyed as ${card.name} left the field.`
            );
            this.updateBoard();
          }
        });
        card.equippedTo = null;
        return;
      }

      if (host && Array.isArray(host.equips)) {
        const idxEquip = host.equips.indexOf(card);
        if (idxEquip > -1) {
          host.equips.splice(idxEquip, 1);
        }
      }

      if (typeof card.equipAtkBonus === "number" && card.equipAtkBonus !== 0) {
        host.atk -= card.equipAtkBonus;
        card.equipAtkBonus = 0;
      }

      if (typeof card.equipDefBonus === "number" && card.equipDefBonus !== 0) {
        host.def -= card.equipDefBonus;
        card.equipDefBonus = 0;
      }

      if (
        typeof card.equipExtraAttacks === "number" &&
        card.equipExtraAttacks !== 0
      ) {
        const currentExtra = host.extraAttacks || 0;
        const nextExtra = currentExtra - card.equipExtraAttacks;
        host.extraAttacks = Math.max(0, nextExtra);
        card.equipExtraAttacks = 0;
      }

      const maxAttacksAfterEquipChange = 1 + (host.extraAttacks || 0);
      host.hasAttacked =
        (host.attacksUsedThisTurn || 0) >= maxAttacksAfterEquipChange;

      if (card.grantsBattleIndestructible) {
        host.battleIndestructible = false;
        card.grantsBattleIndestructible = false;
      }

      if (card.grantsCrescentShieldGuard) {
        card.grantsCrescentShieldGuard = false;
      }

      card.equippedTo = null;
    }

    if (toZone === "fieldSpell") {
      if (destPlayer.fieldSpell) {
        this.moveCard(destPlayer.fieldSpell, destPlayer, "graveyard", {
          fromZone: "fieldSpell",
        });
      }

      if (options.position) {
        card.position = options.position;
      }
      if (typeof options.isFacedown === "boolean") {
        card.isFacedown = options.isFacedown;
      }

      card.owner = destPlayer.id;
      destPlayer.fieldSpell = card;
      return;
    }

    // If a monster leaves the field to the graveyard, send attached equip spells too.
    if (
      fromZone === "field" &&
      toZone === "graveyard" &&
      card.cardKind === "monster"
    ) {
      const equipZone = this.getZone(fromOwner, "spellTrap") || [];
      const attachedEquips = equipZone.filter(
        (eq) =>
          eq &&
          eq.cardKind === "spell" &&
          eq.subtype === "equip" &&
          (eq.equippedTo === card || eq.equipTarget === card)
      );
      attachedEquips.forEach((equip) => {
        this.moveCard(equip, fromOwner, "graveyard", {
          fromZone: "spellTrap",
        });
        if (equip.equippedTo === card) {
          equip.equippedTo = null;
        }
        if (equip.equipTarget === card) {
          equip.equipTarget = null;
        }
      });

      // Se o monstro foi revivido por Call of the Haunted, destruir a trap também
      if (card.callOfTheHauntedTrap) {
        const callTrap = card.callOfTheHauntedTrap;
        void this.destroyCard(callTrap, {
          cause: "effect",
          sourceCard: card,
          opponent: this.getOpponent(fromOwner),
        }).then((result) => {
          if (result?.destroyed) {
            this.renderer.log(
              `${callTrap.name} was destroyed as ${card.name} left the field.`
            );
            this.updateBoard();
          }
        });
        card.callOfTheHauntedTrap = null;
      }
    }

    // Se Call of the Haunted sai do campo, destruir o monstro revivido
    if (
      fromZone === "spellTrap" &&
      toZone === "graveyard" &&
      card.cardKind === "trap" &&
      card.subtype === "continuous" &&
      card.name === "Call of the Haunted" &&
      card.callOfTheHauntedTarget
    ) {
      const revivedMonster = card.callOfTheHauntedTarget;
      const monsterOwner =
        revivedMonster.owner === "player" ? this.player : this.bot;
      void this.destroyCard(revivedMonster, {
        cause: "effect",
        sourceCard: card,
        opponent: this.getOpponent(monsterOwner),
      }).then((result) => {
        if (result?.destroyed) {
          this.renderer.log(
            `${revivedMonster.name} was destroyed as ${card.name} left the field.`
          );
          this.updateBoard();
        }
      });
      card.callOfTheHauntedTarget = null;
    }

    if (options.position) {
      card.position = options.position;
    }
    if (typeof options.isFacedown === "boolean") {
      card.isFacedown = options.isFacedown;
    }
    if (options.resetAttackFlags) {
      card.hasAttacked = false;
      card.cannotAttackThisTurn = false;
      card.attacksUsedThisTurn = 0;
      card.canMakeSecondAttackThisTurn = false;
      card.secondAttackUsedThisTurn = false;
    }

    card.owner = destPlayer.id;

    // Special case: Fusion monsters returning to hand go back to Extra Deck instead
    if (toZone === "hand" && card.monsterType === "fusion") {
      const extraDeck = this.getZone(destPlayer, "extraDeck");
      if (extraDeck) {
        extraDeck.push(card);
        this.renderer.log(`${card.name} returned to Extra Deck.`);
        return;
      }
    }

    destArr.push(card);

    if (
      toZone === "field" &&
      card.cardKind === "monster" &&
      fromZone !== "field" &&
      this.effectEngine &&
      typeof this.effectEngine.handleEvent === "function"
    ) {
      const ownerPlayer = card.owner === "player" ? this.player : this.bot;
      const otherPlayer = ownerPlayer === this.player ? this.bot : this.player;
      this.effectEngine.handleEvent("after_summon", {
        card,
        player: ownerPlayer,
        opponent: otherPlayer,
        method: "special",
        fromZone,
      });
    }

    if (
      toZone === "graveyard" &&
      this.effectEngine &&
      typeof this.effectEngine.handleEvent === "function"
    ) {
      const ownerPlayer = card.owner === "player" ? this.player : this.bot;
      const otherPlayer = ownerPlayer === this.player ? this.bot : this.player;

      console.log(
        `[moveCard] Emitting card_to_grave event for ${card.name} (fromZone: ${fromZone})`
      );

      this.effectEngine.handleEvent("card_to_grave", {
        card,
        fromZone: fromZone || options.fromZone || null,
        toZone: "graveyard",
        player: ownerPlayer,
        opponent: otherPlayer,
        wasDestroyed: options.wasDestroyed || false,
      });
    }
  }

  applyBattleDestroyEffect(attacker, destroyed) {
    // Legacy: onBattleDestroy direct damage effects tied to the attacker
    if (
      attacker &&
      attacker.onBattleDestroy &&
      attacker.onBattleDestroy.damage
    ) {
      const defender = attacker.owner === "player" ? this.bot : this.player;
      defender.takeDamage(attacker.onBattleDestroy.damage);
      this.renderer.log(
        `${attacker.name} inflicts an extra ${attacker.onBattleDestroy.damage} damage!`
      );
      this.checkWinCondition();
      this.updateBoard();
    }

    // New: global battle_destroy event for cards like Shadow-Heart Gecko
    if (
      !destroyed ||
      !this.effectEngine ||
      typeof this.effectEngine.handleEvent !== "function"
    ) {
      return;
    }

    const destroyedOwner =
      destroyed.owner === "player" ? this.player : this.bot;
    const attackerOwner = attacker.owner === "player" ? this.player : this.bot;

    this.effectEngine.handleEvent("battle_destroy", {
      player: attackerOwner, // o dono do atacante (quem causou a destruição)
      opponent: destroyedOwner, // o jogador que perdeu o monstro
      attacker,
      destroyed,
      attackerOwner,
      destroyedOwner,
    });
  }

  setSpellOrTrap(card, handIndex) {
    if (this.turn !== "player") return;
    if (this.phase !== "main1" && this.phase !== "main2") return;
    if (!card) return;
    if (card.cardKind !== "spell" && card.cardKind !== "trap") return;

    if (card.cardKind === "spell" && card.subtype === "field") {
      this.renderer.log("Field Spells cannot be Set.");
      return;
    }

    const zone = this.player.spellTrap;
    if (zone.length >= 5) {
      this.renderer.log("Spell/Trap zone is full (max 5 cards).");
      return;
    }

    card.isFacedown = true;
    card.turnSetOn = this.turnCounter;

    if (typeof this.moveCard === "function") {
      this.moveCard(card, this.player, "spellTrap", { fromZone: "hand" });
    } else {
      if (handIndex >= 0 && handIndex < this.player.hand.length) {
        this.player.hand.splice(handIndex, 1);
      }
      this.player.spellTrap.push(card);
    }

    this.updateBoard();
  }

  async tryActivateSpell(card, handIndex, selections = null, options = {}) {
    await this.runActivationPipeline({
      card,
      owner: this.player,
      selections,
      selectionKind: "spellTrapEffect",
      selectionMessage: "Select target(s) for the continuous spell effect.",
      gate: () => {
        if (this.turn !== "player") return { ok: false };
        if (this.phase !== "main1" && this.phase !== "main2") {
          return { ok: false, reason: "Can only activate spells during Main Phase." };
        }
        if (this.isResolvingEffect) {
          return {
            ok: false,
            reason: "Finish the current effect before activating another card.",
          };
        }
        return { ok: true };
      },
      preview: () =>
        this.effectEngine?.canActivateSpellFromHandPreview?.(card, this.player),
      commit: () => this.commitCardActivationFromHand(this.player, handIndex),
      activationContext: {
        fromHand: true,
        sourceZone: "hand",
      },
      activate: (chosen, ctx, zone, resolvedCard) =>
        this.effectEngine.activateSpellTrapEffect(
          resolvedCard,
          this.player,
          chosen,
          zone,
          ctx
        ),
      finalize: (result, info) => {
        if (result.placementOnly) {
          this.renderer.log(`${info.card.name} is placed on the field.`);
        } else {
          this.finalizeSpellTrapActivation(
            info.card,
            this.player,
            info.activationZone
          );
          this.renderer.log(`${info.card.name} effect activated.`);
        }
        this.updateBoard();
      },
    });
  }

  rollbackSpellActivation(player, commitInfo) {
    if (!player || !commitInfo || !commitInfo.cardRef) return;
    const { cardRef, activationZone, fromIndex, replacedFieldSpell } =
      commitInfo;
    const sourceZone = activationZone || "spellTrap";
    this.moveCard(cardRef, player, "hand", { fromZone: sourceZone });

    if (
      typeof fromIndex === "number" &&
      fromIndex >= 0 &&
      fromIndex < player.hand.length
    ) {
      const currentIndex = player.hand.indexOf(cardRef);
      if (currentIndex > -1 && currentIndex !== fromIndex) {
        player.hand.splice(currentIndex, 1);
        player.hand.splice(fromIndex, 0, cardRef);
      }
    }

    if (
      activationZone === "fieldSpell" &&
      replacedFieldSpell &&
      player.graveyard?.includes(replacedFieldSpell)
    ) {
      this.moveCard(replacedFieldSpell, player, "fieldSpell", {
        fromZone: "graveyard",
      });
    }

    this.updateBoard();
  }

  /**
   * Move a Spell/Trap from hand to the appropriate zone before resolving
   * activation. Returns the committed card reference and activation zone.
   */
  commitCardActivationFromHand(player, handIndex) {
    if (!player || handIndex == null) return null;
    const card = player.hand?.[handIndex];
    if (!card) return null;
    if (card.cardKind !== "spell" && card.cardKind !== "trap") return null;

    const isFieldSpell = card.subtype === "field";
    const activationZone = isFieldSpell ? "fieldSpell" : "spellTrap";
    const replacedFieldSpell = isFieldSpell ? player.fieldSpell : null;

    // Check zone capacity
    if (!isFieldSpell && player.spellTrap.length >= 5) {
      this.renderer.log("Spell/Trap zone is full (max 5 cards).");
      return null;
    }

    // Ensure face-up when placed
    card.isFacedown = false;

    // Move to destination
    if (typeof this.moveCard === "function") {
      this.moveCard(card, player, activationZone, { fromZone: "hand" });
    } else {
      // Fallback (should not happen)
      player.hand.splice(handIndex, 1);
      if (isFieldSpell) {
        player.fieldSpell = card;
      } else {
        player.spellTrap.push(card);
      }
    }

    // Determine zone index if in S/T array
    const zoneIndex =
      activationZone === "spellTrap" ? player.spellTrap.indexOf(card) : null;

    this.updateBoard();

    return {
      cardRef: card,
      activationZone,
      zoneIndex,
      fromIndex: handIndex,
      replacedFieldSpell,
    };
  }

  showShadowHeartCathedralModal(validMonsters, maxAtk, counterCount, callback) {
    console.log(
      `[Cathedral Modal] Opening with ${validMonsters.length} valid monsters, Max ATK: ${maxAtk}, Counters: ${counterCount}`
    );

    if (
      this.renderer &&
      typeof this.renderer.showCardGridSelectionModal === "function"
    ) {
      console.log("[Cathedral Modal] Using showCardGridSelectionModal");
      this.renderer.showCardGridSelectionModal({
        title: "Shadow-Heart Cathedral",
        subtitle: `Choose a <strong>Shadow-Heart</strong> monster from your Deck to Special Summon.<br><span class="counter-info">${counterCount} Judgment Counter(s) - Max ATK: ${maxAtk}</span>`,
        cards: validMonsters,
        minSelect: 1,
        maxSelect: 1,
        confirmLabel: "Summon",
        cancelLabel: "Cancel",
        overlayClass: "modal cathedral-overlay",
        modalClass: "modal-content cathedral-modal",
        gridClass: "cathedral-card-list",
        cardClass: "cathedral-card-item",
        infoText: `Select a monster with ATK ≤ ${maxAtk}`,
        onConfirm: (chosen) => {
          console.log("[Cathedral Modal] Confirm called with:", chosen);
          const card = chosen && chosen.length > 0 ? chosen[0] : null;
          if (card) {
            console.log("[Cathedral Modal] Selected:", card.name);
          }
          callback(card || null);
        },
        onCancel: () => {
          console.log("[Cathedral Modal] Cancel called");
          callback(null);
        },
        renderCard: (monster) => {
          try {
            const cardItem = document.createElement("div");
            cardItem.classList.add("cathedral-card-item");
            cardItem.style.display = "flex";
            cardItem.style.alignItems = "center";
            cardItem.style.gap = "12px";
            cardItem.style.padding = "12px";
            cardItem.style.margin = "8px 0";
            cardItem.style.border = "2px solid #555";
            cardItem.style.borderRadius = "8px";
            cardItem.style.cursor = "pointer";
            cardItem.style.transition = "all 0.2s";
            cardItem.style.backgroundColor = "#2a2a2a";
            cardItem.style.minHeight = "100px";

            const cardImg = document.createElement("img");
            cardImg.src = monster.image || "assets/card-back.png";
            cardImg.alt = monster.name;
            cardImg.classList.add("cathedral-card-img");
            cardImg.style.width = "80px";
            cardImg.style.height = "120px";
            cardImg.style.objectFit = "cover";
            cardImg.style.borderRadius = "4px";
            cardImg.style.flexShrink = "0";
            cardImg.style.border = "1px solid #444";

            const cardInfo = document.createElement("div");
            cardInfo.classList.add("cathedral-card-info");
            cardInfo.style.flex = "1";
            cardInfo.style.display = "flex";
            cardInfo.style.flexDirection = "column";
            cardInfo.style.gap = "8px";

            const cardName = document.createElement("div");
            cardName.textContent = monster.name;
            cardName.classList.add("cathedral-card-name");
            cardName.style.fontWeight = "bold";
            cardName.style.fontSize = "16px";
            cardName.style.color = "#fff";
            cardName.style.lineHeight = "1.3";

            const cardStats = document.createElement("div");
            cardStats.textContent = `ATK ${monster.atk || 0} / DEF ${
              monster.def || 0
            } / Level ${monster.level || 0}`;
            cardStats.classList.add("cathedral-card-stats");
            cardStats.style.fontSize = "14px";
            cardStats.style.color = "#aaa";
            cardStats.style.fontWeight = "500";

            cardInfo.appendChild(cardName);
            cardInfo.appendChild(cardStats);
            cardItem.appendChild(cardImg);
            cardItem.appendChild(cardInfo);
            return cardItem;
          } catch (e) {
            console.error("[Cathedral Modal] Error in renderCard:", e);
            return null;
          }
        },
      });
      return;
    }

    console.log(
      "[Cathedral Modal] Using fallback prompt (no renderer available)"
    );
    // Fallback simple prompt
    const choice = window.prompt(
      "Choose a Shadow-Heart monster name to summon:"
    );
    if (!choice) {
      callback(null);
      return;
    }
    const normalized = choice.trim().toLowerCase();
    const card = validMonsters.find(
      (c) => c.name && c.name.trim().toLowerCase() === normalized
    );
    callback(card || null);
  }

  canActivateTrap(card) {
    console.log(
      `[canActivateTrap] Checking: ${card?.name}, cardKind: ${card?.cardKind}, isFacedown: ${card?.isFacedown}, turnSetOn: ${card?.turnSetOn}, currentTurn: ${this.turnCounter}`
    );
    if (!card || card.cardKind !== "trap") return false;
    if (!card.isFacedown) return false;
    if (!card.turnSetOn) return false;

    // Trap só pode ser ativada a partir do próximo turno
    const result = this.turnCounter > card.turnSetOn;
    console.log(
      `[canActivateTrap] Result: ${result} (${this.turnCounter} > ${card.turnSetOn})`
    );
    return result;
  }

  async checkAndOfferTraps(event, eventData = {}) {
    if (!this.player) return;

    // Evitar reentrância: se já existe um modal de trap aberto, não abrir outro
    if (this.trapPromptInProgress) return;
    this.trapPromptInProgress = true;

    try {
      const eligibleTraps = this.player.spellTrap.filter((card) => {
        if (!this.canActivateTrap(card)) return false;

        // Verificar se a trap tem efeito que responde a este evento
        if (!card.effects || card.effects.length === 0) return false;

        return card.effects.some((effect) => {
          if (effect.timing === "manual") return event === "phase_end";
          if (effect.timing !== "on_event") return false;
          if (effect.event !== event) return false;

          // Verificar condições específicas do evento
          if (effect.requireOpponentAttack && !eventData.isOpponentAttack)
            return false;
          if (effect.requireOpponentSummon && !eventData.isOpponentSummon)
            return false;

          return true;
        });
      });

      if (eligibleTraps.length === 0) return;

      // Oferecer ativação de cada trap elegível (uma por vez)
      for (const trap of eligibleTraps) {
        const shouldActivate = await this.renderer.showTrapActivationModal(
          trap,
          event,
          eventData
        );

        if (shouldActivate) {
          await this.activateTrapFromZone(trap, eventData);
          break; // Por enquanto, apenas uma trap por evento
        }
      }
    } finally {
      this.trapPromptInProgress = false; // Avoid multiple trap prompts simultaneously
      this.testModeEnabled = false;
    }
  }

  async activateTrapFromZone(card, eventData = {}) {
    if (!card || card.cardKind !== "trap") return;

    const trapIndex = this.player.spellTrap.indexOf(card);
    if (trapIndex === -1) return;

    // Virar a carta face-up
    card.isFacedown = false;
    this.renderer.log(`${this.player.name} ativa ${card.name}!`);

    // Resolver efeitos
    const result = await this.effectEngine.resolveTrapEffects(
      card,
      this.player,
      eventData
    );

    // Se for trap normal, mover para o cemitério após resolver
    if (card.subtype === "normal") {
      this.moveCard(card, this.player, "graveyard", { fromZone: "spellTrap" });
    }
    // Se for continuous, permanece no campo face-up

    this.updateBoard();
    return result;
  }

  async emitWithTrapCheck(event, eventData = {}) {
    // Primeiro emite o evento normalmente
    await this.emit(event, eventData);

    // Depois verifica se há traps que podem responder
    if (this.turn !== "player") {
      // Se é o turno do bot, verificar traps do player (defensor)
      await this.checkAndOfferTraps(event, {
        ...eventData,
        isOpponentSummon: eventData.player?.id === "bot",
        isOpponentAttack: eventData.attackerOwner?.id === "bot",
      });
    }
  }

  resolvePlayerById(id = "player") {
    return id === "bot" ? this.bot : this.player;
  }

  resolveCardData(identifier) {
    if (identifier && typeof identifier === "object") {
      if (typeof identifier.id === "number") {
        const found = cardDatabaseById.get(identifier.id);
        if (found) return found;
      }
      if (identifier.name) {
        return this.resolveCardData(identifier.name);
      }
    }

    if (typeof identifier === "number") {
      return cardDatabaseById.get(identifier) || null;
    }

    if (typeof identifier !== "string") {
      return null;
    }

    const trimmed = identifier.trim();
    if (!trimmed) return null;

    let data = cardDatabaseByName.get(trimmed);
    if (data) return data;

    const lower = trimmed.toLowerCase();
    for (const [name, item] of cardDatabaseByName.entries()) {
      if (typeof name === "string" && name.toLowerCase() === lower) {
        return item;
      }
    }
    return null;
  }

  createCardForOwner(identifier, owner, overrides = {}) {
    const player =
      typeof owner === "string" ? this.resolvePlayerById(owner) : owner;
    if (!player) return null;
    const data = this.resolveCardData(identifier);
    if (!data) return null;

    const card = new Card(data, player.id);
    if (overrides.position) {
      card.position = overrides.position === "defense" ? "defense" : "attack";
    }
    if (typeof overrides.isFacedown === "boolean") {
      card.isFacedown = overrides.isFacedown;
    } else if (overrides.facedown === true) {
      card.isFacedown = true;
    }
    if (overrides.turnSetOn != null) {
      card.turnSetOn = overrides.turnSetOn;
    }
    if (overrides.counters && card.counters instanceof Map) {
      Object.entries(overrides.counters).forEach(([type, amount]) => {
        if (typeof amount === "number" && amount > 0) {
          card.counters.set(type, amount);
        }
      });
    }
    return card;
  }

  devDraw(playerId = "player", count = 1) {
    if (!this.devModeEnabled) {
      return { success: false, reason: "Dev Mode is disabled." };
    }

    const player = this.resolvePlayerById(playerId);
    if (!player) {
      return { success: false, reason: "Invalid player id." };
    }

    const draws = Math.max(1, Number(count) || 1);
    const drawn = [];
    for (let i = 0; i < draws; i++) {
      const card = player.draw();
      if (!card) break;
      drawn.push(card.name);
    }

    if (!drawn.length) {
      return { success: false, reason: "Deck is empty." };
    }

    this.updateBoard();
    this.devLog("DEV_DRAW", {
      summary: `${player.id} drew ${drawn.length}`,
      player: player.id,
      cards: drawn,
    });
    return { success: true, drawn };
  }

  devGiveCard(options = {}) {
    if (!this.devModeEnabled) {
      return { success: false, reason: "Dev Mode is disabled." };
    }

    const player = this.resolvePlayerById(options.playerId || "player");
    if (!player) {
      return { success: false, reason: "Invalid player id." };
    }

    const zone = (options.zone || "hand").toLowerCase();
    const card = this.createCardForOwner(
      options.cardName || options.name,
      player,
      options
    );
    if (!card) {
      return { success: false, reason: "Card not found." };
    }

    const sendOldFieldSpell = (existing) => {
      if (existing) {
        player.graveyard.push(existing);
      }
    };

    if (zone === "hand") {
      player.hand.push(card);
    } else if (zone === "graveyard") {
      player.graveyard.push(card);
    } else if (zone === "spelltrap") {
      if (player.spellTrap.length >= 5) {
        return { success: false, reason: "Spell/Trap zone is full." };
      }
      if (card.cardKind === "monster") {
        return {
          success: false,
          reason: "Only Spell/Trap cards can go to that zone.",
        };
      }
      player.spellTrap.push(card);
    } else if (zone === "field-attack" || zone === "field-defense") {
      if (player.field.length >= 5) {
        return { success: false, reason: "Field is full (max 5 monsters)." };
      }
      if (card.cardKind !== "monster") {
        return { success: false, reason: "Only monsters can enter the field." };
      }
      card.position = zone === "field-defense" ? "defense" : "attack";
      card.hasAttacked = false;
      card.attacksUsedThisTurn = 0;
      player.field.push(card);
    } else if (zone === "fieldspell") {
      if (card.cardKind !== "spell" || card.subtype !== "field") {
        return { success: false, reason: "Card is not a Field Spell." };
      }
      sendOldFieldSpell(player.fieldSpell);
      player.fieldSpell = card;
    } else {
      return { success: false, reason: "Unsupported zone." };
    }

    this.updateBoard();
    this.devLog("DEV_GIVE_CARD", {
      summary: `${card.name} -> ${zone} (${player.id})`,
      player: player.id,
      card: card.name,
      zone,
    });
    return { success: true, card };
  }

  devForcePhase(targetPhase, options = {}) {
    if (!this.devModeEnabled) {
      return { success: false, reason: "Dev Mode is disabled." };
    }

    const validPhases = new Set([
      "draw",
      "standby",
      "main1",
      "battle",
      "main2",
      "end",
    ]);
    if (!validPhases.has(targetPhase)) {
      return { success: false, reason: "Invalid phase." };
    }

    this.phase = targetPhase;
    if (options.turn === "player" || options.turn === "bot") {
      this.turn = options.turn;
    }
    this.updateBoard();
    this.devLog("DEV_FORCE_PHASE", {
      summary: `Phase forced to ${this.phase}`,
      phase: this.phase,
      turn: this.turn,
    });
    return { success: true };
  }

  devGetSelectionCleanupState() {
    const controlsVisible = !!document.querySelector(".field-targeting-controls");
    const highlightCount = document.querySelectorAll(
      ".card.targetable, .card.selected-target"
    ).length;
    return {
      selectionActive: !!this.targetSelection,
      selectionState: this.selectionState,
      controlsVisible,
      highlightCount,
    };
  }

  devForceTargetCleanup() {
    this.clearTargetHighlights();
    if (
      this.renderer &&
      typeof this.renderer.hideFieldTargetingControls === "function"
    ) {
      this.renderer.hideFieldTargetingControls();
    }
    if (this.targetSelection?.closeModal) {
      this.targetSelection.closeModal();
    }
    this.targetSelection = null;
    this.setSelectionState("idle");
  }

  async devAutoConfirmTargetSelection() {
    if (!this.devModeEnabled) {
      return { success: false, reason: "Dev Mode is disabled." };
    }
    const selection = this.targetSelection;
    if (!selection || !Array.isArray(selection.requirements)) {
      return { success: false, reason: "No active target selection." };
    }

    const selections = {};
    let canSatisfy = true;

    for (const requirement of selection.requirements) {
      const min = Number(requirement.min ?? 0);
      const candidates = Array.isArray(requirement.candidates)
        ? requirement.candidates
        : [];
      if (candidates.length < min) {
        canSatisfy = false;
      }
      selections[requirement.id] = candidates
        .slice(0, min)
        .map((cand) => cand.key);
    }

    if (!canSatisfy) {
      return { success: false, reason: "Not enough candidates to auto-confirm." };
    }

    selection.selections = selections;
    selection.currentRequirement = selection.requirements.length;
    this.setSelectionState("confirming");
    await this.finishTargetSelection();
    return { success: true };
  }

  async devRunSanityA() {
    if (!this.devModeEnabled) {
      return { success: false, reason: "Dev Mode is disabled." };
    }

    this.devLog("SANITY_A_START", {
      summary: "Sanity A: hand spell target + cancel",
    });

    const setupResult = this.applyManualSetup({
      turn: "player",
      phase: "main1",
      player: {
        hand: ["Luminarch Holy Ascension"],
        field: [
          { name: "Luminarch Valiant - Knight of the Dawn", position: "attack" },
        ],
      },
      bot: { field: [] },
    });

    if (!setupResult.success) {
      return setupResult;
    }

    const card = this.player.hand.find(
      (c) => c && c.name === "Luminarch Holy Ascension"
    );
    if (!card) {
      return { success: false, reason: "Sanity A card not found in hand." };
    }
    const handIndex = this.player.hand.indexOf(card);

    const pipelineResult = await this.runActivationPipeline({
      card,
      owner: this.player,
      selectionKind: "spellTrapEffect",
      selectionMessage: "Sanity A: select target(s) for the spell.",
      gate: () => {
        if (this.turn !== "player") return { ok: false };
        if (this.phase !== "main1" && this.phase !== "main2") {
          return {
            ok: false,
            reason: "Can only activate spells during Main Phase.",
          };
        }
        if (this.isResolvingEffect) {
          return {
            ok: false,
            reason: "Finish the current effect before activating another card.",
          };
        }
        return { ok: true };
      },
      preview: () =>
        this.effectEngine?.canActivateSpellFromHandPreview?.(
          card,
          this.player
        ),
      commit: () => this.commitCardActivationFromHand(this.player, handIndex),
      activationContext: {
        fromHand: true,
        sourceZone: "hand",
      },
      activate: (chosen, ctx, zone, resolvedCard) =>
        this.effectEngine.activateSpellTrapEffect(
          resolvedCard,
          this.player,
          chosen,
          zone,
          ctx
        ),
      finalize: (result, info) => {
        if (!result.placementOnly) {
          this.finalizeSpellTrapActivation(
            info.card,
            this.player,
            info.activationZone
          );
        }
        this.updateBoard();
      },
    });

    const selection = this.targetSelection;
    const selectionOpened = !!selection;
    const allowCancel = selectionOpened ? !selection.preventCancel : false;
    const contractOk = selectionOpened
      ? Array.isArray(selection.selectionContract?.requirements) &&
        selection.selectionContract.requirements.length > 0
      : false;
    let selectionResolved = false;
    let cancelAttempted = false;

    if (selectionOpened) {
      if (allowCancel) {
        cancelAttempted = true;
        this.cancelTargetSelection();
        selectionResolved = true;
      } else {
        const autoResult = await this.devAutoConfirmTargetSelection();
        selectionResolved = autoResult.success;
      }
    }

    this.devForceTargetCleanup();
    const cleanupState = this.devGetSelectionCleanupState();
    const cleanupOk =
      !cleanupState.selectionActive &&
      !cleanupState.controlsVisible &&
      cleanupState.highlightCount === 0;

    const success =
      selectionOpened && selectionResolved && cleanupOk && contractOk;
    this.devLog("SANITY_A_RESULT", {
      summary: "Sanity A result",
      selectionOpened,
      allowCancel,
      contractOk,
      cancelAttempted,
      selectionResolved,
      cleanupOk,
      pipelineResult,
    });
    return {
      success,
      selectionOpened,
      allowCancel,
      contractOk,
      selectionResolved,
      cleanupOk,
      pipelineResult,
    };
  }

  async devRunSanityB() {
    if (!this.devModeEnabled) {
      return { success: false, reason: "Dev Mode is disabled." };
    }

    this.devLog("SANITY_B_START", {
      summary: "Sanity B: placement-only spell",
    });

    const setupResult = this.applyManualSetup({
      turn: "player",
      phase: "main1",
      player: {
        hand: ["Darkness Valley"],
      },
      bot: { field: [] },
    });

    if (!setupResult.success) {
      return setupResult;
    }

    const card = this.player.hand.find(
      (c) => c && c.name === "Darkness Valley"
    );
    if (!card) {
      return { success: false, reason: "Sanity B card not found in hand." };
    }
    const handIndex = this.player.hand.indexOf(card);
    const cardRef = card;

    const pipelineResult = await this.runActivationPipeline({
      card,
      owner: this.player,
      selectionKind: "spellTrapEffect",
      selectionMessage: "Sanity B: placement-only check.",
      gate: () => {
        if (this.turn !== "player") return { ok: false };
        if (this.phase !== "main1" && this.phase !== "main2") {
          return {
            ok: false,
            reason: "Can only activate spells during Main Phase.",
          };
        }
        if (this.isResolvingEffect) {
          return {
            ok: false,
            reason: "Finish the current effect before activating another card.",
          };
        }
        return { ok: true };
      },
      preview: () =>
        this.effectEngine?.canActivateSpellFromHandPreview?.(
          card,
          this.player
        ),
      commit: () => this.commitCardActivationFromHand(this.player, handIndex),
      activationContext: {
        fromHand: true,
        sourceZone: "hand",
      },
      activate: (chosen, ctx, zone, resolvedCard) =>
        this.effectEngine.activateSpellTrapEffect(
          resolvedCard,
          this.player,
          chosen,
          zone,
          ctx
        ),
      finalize: (result) => {
        if (!result.placementOnly) {
          this.finalizeSpellTrapActivation(card, this.player);
        }
        this.updateBoard();
      },
    });

    this.devForceTargetCleanup();
    const cleanupState = this.devGetSelectionCleanupState();
    const cleanupOk =
      !cleanupState.selectionActive &&
      !cleanupState.controlsVisible &&
      cleanupState.highlightCount === 0;

    const placementOnlyOk =
      pipelineResult?.success === true &&
      pipelineResult?.needsSelection === false &&
      pipelineResult?.placementOnly === true;
    const placedOk = this.player.fieldSpell === cardRef;
    const success = placementOnlyOk && placedOk && cleanupOk;

    this.devLog("SANITY_B_RESULT", {
      summary: "Sanity B result",
      placementOnlyOk,
      placedOk,
      cleanupOk,
      pipelineResult,
    });
    return {
      success,
      placementOnlyOk,
      placedOk,
      cleanupOk,
      pipelineResult,
    };
  }

  async devRunSanityC() {
    if (!this.devModeEnabled) {
      return { success: false, reason: "Dev Mode is disabled." };
    }

    this.devLog("SANITY_C_START", {
      summary: "Sanity C: committed field spell fail + restore",
    });

    const setupResult = this.applyManualSetup({
      turn: "player",
      phase: "main1",
      player: {
        hand: ["Darkness Valley"],
        fieldSpell: "Sanctum of the Luminarch Citadel",
      },
      bot: { field: [] },
    });

    if (!setupResult.success) {
      return setupResult;
    }

    const card = this.player.hand.find(
      (c) => c && c.name === "Darkness Valley"
    );
    if (!card) {
      return { success: false, reason: "Sanity C card not found in hand." };
    }
    const handIndex = this.player.hand.indexOf(card);
    const cardRef = card;
    const replacedFieldSpell = this.player.fieldSpell;

    const pipelineResult = await this.runActivationPipeline({
      card,
      owner: this.player,
      selectionKind: "spellTrapEffect",
      selectionMessage: "Sanity C: forced failure for rollback.",
      gate: () => {
        if (this.turn !== "player") return { ok: false };
        if (this.phase !== "main1" && this.phase !== "main2") {
          return {
            ok: false,
            reason: "Can only activate spells during Main Phase.",
          };
        }
        if (this.isResolvingEffect) {
          return {
            ok: false,
            reason: "Finish the current effect before activating another card.",
          };
        }
        return { ok: true };
      },
      preview: () =>
        this.effectEngine?.canActivateSpellFromHandPreview?.(
          card,
          this.player
        ),
      commit: () => this.commitCardActivationFromHand(this.player, handIndex),
      activationContext: {
        fromHand: true,
        sourceZone: "hand",
        devFailAfterCommit: true,
      },
      activate: (chosen, ctx, zone, resolvedCard) =>
        this.effectEngine.activateSpellTrapEffect(
          resolvedCard,
          this.player,
          chosen,
          zone,
          ctx
        ),
    });

    this.devForceTargetCleanup();
    const cleanupState = this.devGetSelectionCleanupState();
    const cleanupOk =
      !cleanupState.selectionActive &&
      !cleanupState.controlsVisible &&
      cleanupState.highlightCount === 0;

    const failureOk =
      pipelineResult?.success === false &&
      pipelineResult?.needsSelection === false;
    const restoredIndex = this.player.hand.indexOf(cardRef);
    const restoredHandOk = restoredIndex === handIndex;
    const restoredFieldOk = this.player.fieldSpell === replacedFieldSpell;
    const restoredGyOk =
      replacedFieldSpell && !this.player.graveyard.includes(replacedFieldSpell);
    const rollbackOk = restoredHandOk && restoredFieldOk && restoredGyOk;
    const success = failureOk && rollbackOk && cleanupOk;

    this.devLog("SANITY_C_RESULT", {
      summary: "Sanity C result",
      failureOk,
      rollbackOk,
      restoredHandOk,
      restoredFieldOk,
      restoredGyOk,
      cleanupOk,
      pipelineResult,
    });
    return {
      success,
      failureOk,
      rollbackOk,
      restoredHandOk,
      restoredFieldOk,
      restoredGyOk,
      cleanupOk,
      pipelineResult,
    };
  }

  async devRunSanityD() {
    if (!this.devModeEnabled) {
      return { success: false, reason: "Dev Mode is disabled." };
    }

    this.devLog("SANITY_D_START", {
      summary: "Sanity D: triggered target flow",
    });

    const setupResult = this.applyManualSetup({
      turn: "player",
      phase: "main1",
      player: {
        spellTrap: ["Sword of Two Darks"],
      },
      bot: {
        spellTrap: ["Mirror Force"],
      },
    });

    if (!setupResult.success) {
      return setupResult;
    }

    const triggerCard = this.player.spellTrap.find(
      (c) => c && c.name === "Sword of Two Darks"
    );
    if (!triggerCard) {
      return { success: false, reason: "Sanity D trigger card not found." };
    }

    const targetCard = this.bot.spellTrap.find(
      (c) => c && c.name === "Mirror Force"
    );

    this.moveCard(triggerCard, this.player, "graveyard", {
      fromZone: "spellTrap",
      wasDestroyed: true,
    });
    this.updateBoard();

    const waitForSelection = async (attempts = 20, delayMs = 25) => {
      for (let i = 0; i < attempts; i += 1) {
        if (this.targetSelection) return true;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return false;
    };

    await waitForSelection();

    const selection = this.targetSelection;
    const selectionOpened = !!selection;
    const allowCancel = selectionOpened ? !selection.preventCancel : false;
    const contract = selectionOpened ? selection.selectionContract : null;
    const requirements = contract?.requirements || [];
    const contractOk = selectionOpened ? requirements.length > 0 : false;
    const candidateCount = selectionOpened
      ? requirements?.[selection.currentRequirement]?.candidates?.length || 0
      : 0;
    const usingFieldTargeting = selectionOpened
      ? !!selection.usingFieldTargeting
      : false;

    let selectionResolved = false;
    if (selectionOpened) {
      const autoResult = await this.devAutoConfirmTargetSelection();
      selectionResolved = autoResult.success;
    }

    const candidateCountOk = candidateCount === 1;
    const allowCancelOk = selectionOpened ? allowCancel === true : false;
    const targetMoved =
      targetCard &&
      !this.bot.spellTrap.includes(targetCard) &&
      this.bot.graveyard.includes(targetCard);

    this.devForceTargetCleanup();
    const cleanupState = this.devGetSelectionCleanupState();
    const cleanupOk =
      !cleanupState.selectionActive &&
      !cleanupState.controlsVisible &&
      cleanupState.highlightCount === 0;

    const success =
      selectionOpened &&
      selectionResolved &&
      cleanupOk &&
      contractOk &&
      candidateCountOk &&
      allowCancelOk &&
      targetMoved;

    this.devLog("SANITY_D_RESULT", {
      summary: "Sanity D result",
      selectionOpened,
      allowCancel,
      contractOk,
      candidateCount,
      candidateCountOk,
      allowCancelOk,
      usingFieldTargeting,
      selectionResolved,
      targetMoved,
      cleanupOk,
    });

    return {
      success,
      selectionOpened,
      allowCancel,
      contractOk,
      candidateCount,
      candidateCountOk,
      allowCancelOk,
      usingFieldTargeting,
      selectionResolved,
      targetMoved,
      cleanupOk,
    };
  }

  async devRunSanityE() {
    if (!this.devModeEnabled) {
      return { success: false, reason: "Dev Mode is disabled." };
    }

    this.devLog("SANITY_E_START", {
      summary: "Sanity E: bot auto-select selection contract",
    });

    const setupResult = this.applyManualSetup({
      turn: "bot",
      phase: "main1",
      player: { field: [] },
      bot: {
        hand: ["Luminarch Holy Ascension"],
        field: [
          { name: "Luminarch Valiant - Knight of the Dawn", position: "attack" },
        ],
      },
    });

    if (!setupResult.success) {
      return setupResult;
    }

    const card = this.bot.hand.find(
      (c) => c && c.name === "Luminarch Holy Ascension"
    );
    if (!card) {
      return { success: false, reason: "Sanity E card not found in bot hand." };
    }
    const handIndex = this.bot.hand.indexOf(card);
    const cardRef = card;

    const pipelineResult = await this.runActivationPipeline({
      card,
      owner: this.bot,
      selectionKind: "spellTrapEffect",
      selectionMessage: "Sanity E: bot auto-select.",
      gate: () => {
        if (this.turn !== "bot") return { ok: false };
        if (this.phase !== "main1" && this.phase !== "main2") {
          return {
            ok: false,
            reason: "Can only activate spells during Main Phase.",
          };
        }
        if (this.isResolvingEffect) {
          return {
            ok: false,
            reason: "Finish the current effect before activating another card.",
          };
        }
        return { ok: true };
      },
      preview: () =>
        this.effectEngine?.canActivateSpellFromHandPreview?.(card, this.bot),
      commit: () => this.commitCardActivationFromHand(this.bot, handIndex),
      activationContext: {
        fromHand: true,
        sourceZone: "hand",
      },
      activate: (chosen, ctx, zone, resolvedCard) =>
        this.effectEngine.activateSpellTrapEffect(
          resolvedCard,
          this.bot,
          chosen,
          zone,
          ctx
        ),
      finalize: (result, info) => {
        if (!result.placementOnly) {
          this.finalizeSpellTrapActivation(
            info.card,
            this.bot,
            info.activationZone
          );
        }
        this.updateBoard();
      },
    });

    const selectionOpened = !!this.targetSelection;
    this.devForceTargetCleanup();
    const cleanupState = this.devGetSelectionCleanupState();
    const cleanupOk =
      !cleanupState.selectionActive &&
      !cleanupState.controlsVisible &&
      cleanupState.highlightCount === 0;

    const resolvedOk =
      pipelineResult?.success === true &&
      pipelineResult?.needsSelection === false;
    const autoSelectedOk = !selectionOpened;
    const graveyardOk = this.bot.graveyard.includes(cardRef);
    const success = resolvedOk && autoSelectedOk && cleanupOk && graveyardOk;

    this.devLog("SANITY_E_RESULT", {
      summary: "Sanity E result",
      resolvedOk,
      autoSelectedOk,
      graveyardOk,
      cleanupOk,
      pipelineResult,
    });

    return {
      success,
      resolvedOk,
      autoSelectedOk,
      graveyardOk,
      cleanupOk,
      pipelineResult,
    };
  }

  async devRunSanityF() {
    if (!this.devModeEnabled) {
      return { success: false, reason: "Dev Mode is disabled." };
    }

    this.devLog("SANITY_F_START", {
      summary: "Sanity F: player strategy manual confirm",
    });

    const setupResult = this.applyManualSetup({
      turn: "player",
      phase: "main1",
      player: {
        field: [
          { name: "Luminarch Valiant - Knight of the Dawn", position: "attack" },
        ],
      },
      bot: { field: [] },
    });

    if (!setupResult.success) {
      return setupResult;
    }

    const source = this.player.field.find(Boolean);
    if (!source) {
      return { success: false, reason: "Sanity F source card not found." };
    }

    const targetDefs = [
      {
        id: "sanity_strategy_target",
        owner: "self",
        zone: "field",
        cardKind: "monster",
        cardName: source.name,
        requireFaceup: true,
        count: { min: 1, max: 1 },
        strategy: "highest_atk",
      },
    ];

    const pipelineResult = await this.runActivationPipeline({
      card: source,
      owner: this.player,
      activationZone: "field",
      activationContext: {
        fromHand: false,
        sourceZone: "field",
      },
      selectionKind: "sanityF",
      selectionMessage: "Sanity F: confirm the target selection.",
      activate: (selections, activationCtx) => {
        const ctx = {
          source,
          player: this.player,
          opponent: this.bot,
          activationZone: "field",
          activationContext: activationCtx,
        };
        const targetResult = this.effectEngine.resolveTargets(
          targetDefs,
          ctx,
          selections
        );
        if (targetResult.needsSelection) {
          return {
            success: false,
            needsSelection: true,
            selectionContract: targetResult.selectionContract,
          };
        }
        if (targetResult.ok === false) {
          return {
            success: false,
            needsSelection: false,
            reason: targetResult.reason,
          };
        }
        return { success: true, needsSelection: false };
      },
    });

    const selection = this.targetSelection;
    const selectionOpened = !!selection;
    const allowCancel = selectionOpened ? !selection.preventCancel : false;
    const contract = selectionOpened ? selection.selectionContract : null;
    const requirement =
      contract?.requirements?.[selection?.currentRequirement ?? 0] ||
      contract?.requirements?.[0] ||
      null;
    const contractOk =
      selectionOpened &&
      Array.isArray(contract?.requirements) &&
      contract.requirements.length > 0;
    const strategyOk = requirement?.filters?.strategy === "highest_atk";
    const candidateCount = requirement?.candidates?.length || 0;

    let selectionResolved = false;
    let cancelAttempted = false;

    if (selectionOpened) {
      if (allowCancel) {
        cancelAttempted = true;
        this.cancelTargetSelection();
        selectionResolved = true;
      } else {
        const autoResult = await this.devAutoConfirmTargetSelection();
        selectionResolved = autoResult.success;
      }
    }

    this.devForceTargetCleanup();
    const cleanupState = this.devGetSelectionCleanupState();
    const cleanupOk =
      !cleanupState.selectionActive &&
      !cleanupState.controlsVisible &&
      cleanupState.highlightCount === 0;

    const candidateCountOk = candidateCount === 1;
    const success =
      selectionOpened &&
      selectionResolved &&
      cleanupOk &&
      contractOk &&
      strategyOk &&
      candidateCountOk;

    this.devLog("SANITY_F_RESULT", {
      summary: "Sanity F result",
      selectionOpened,
      allowCancel,
      contractOk,
      strategyOk,
      candidateCount,
      candidateCountOk,
      cancelAttempted,
      selectionResolved,
      cleanupOk,
      pipelineResult,
    });

    return {
      success,
      selectionOpened,
      allowCancel,
      contractOk,
      strategyOk,
      candidateCount,
      candidateCountOk,
      cancelAttempted,
      selectionResolved,
      cleanupOk,
      pipelineResult,
    };
  }

  async devRunSanityG() {
    if (!this.devModeEnabled) {
      return { success: false, reason: "Dev Mode is disabled." };
    }

    this.devLog("SANITY_G_START", {
      summary: "Sanity G: bot optional min=0 selection",
    });

    const setupResult = this.applyManualSetup({
      turn: "bot",
      phase: "main1",
      player: {
        field: [
          { name: "Luminarch Valiant - Knight of the Dawn", position: "attack" },
        ],
      },
      bot: {
        field: [
          { name: "Luminarch Magic Sickle", position: "attack" },
        ],
      },
    });

    if (!setupResult.success) {
      return setupResult;
    }

    const source = this.bot.field.find(Boolean);
    if (!source) {
      return { success: false, reason: "Sanity G source card not found." };
    }

    const targetDefs = [
      {
        id: "sanity_optional_target",
        owner: "opponent",
        zone: "field",
        cardKind: "monster",
        requireFaceup: true,
        count: { min: 0, max: 1 },
      },
    ];

    let chosenCount = null;
    let selectionPrompted = false;

    const pipelineResult = await this.runActivationPipeline({
      card: source,
      owner: this.bot,
      activationZone: "field",
      activationContext: {
        fromHand: false,
        sourceZone: "field",
      },
      selectionKind: "sanityG",
      selectionMessage: "Sanity G: optional selection (bot).",
      activate: (selections, activationCtx) => {
        const ctx = {
          source,
          player: this.bot,
          opponent: this.player,
          activationZone: "field",
          activationContext: activationCtx,
        };
        const targetResult = this.effectEngine.resolveTargets(
          targetDefs,
          ctx,
          selections
        );
        if (targetResult.needsSelection) {
          selectionPrompted = true;
          return {
            success: false,
            needsSelection: true,
            selectionContract: targetResult.selectionContract,
          };
        }
        if (targetResult.ok === false) {
          return {
            success: false,
            needsSelection: false,
            reason: targetResult.reason,
          };
        }
        const chosen = targetResult.targets?.sanity_optional_target || [];
        chosenCount = chosen.length;
        return { success: true, needsSelection: false };
      },
    });

    const selectionOpened = !!this.targetSelection;
    this.devForceTargetCleanup();
    const cleanupState = this.devGetSelectionCleanupState();
    const cleanupOk =
      !cleanupState.selectionActive &&
      !cleanupState.controlsVisible &&
      cleanupState.highlightCount === 0;

    const resolvedOk =
      pipelineResult?.success === true &&
      pipelineResult?.needsSelection === false;
    const optionalOk = chosenCount === 0;
    const autoSelectedOk = !selectionOpened;
    const success =
      resolvedOk && optionalOk && autoSelectedOk && cleanupOk;

    this.devLog("SANITY_G_RESULT", {
      summary: "Sanity G result",
      selectionPrompted,
      chosenCount,
      resolvedOk,
      optionalOk,
      autoSelectedOk,
      cleanupOk,
      pipelineResult,
    });

    return {
      success,
      selectionPrompted,
      chosenCount,
      resolvedOk,
      optionalOk,
      autoSelectedOk,
      cleanupOk,
      pipelineResult,
    };
  }

  async devRunSanityH() {
    if (!this.devModeEnabled) {
      return { success: false, reason: "Dev Mode is disabled." };
    }

    this.devLog("SANITY_H_START", {
      summary: "Sanity H: Hydra Titan before_destroy battle + Mirror Force",
    });

    const setupResult = this.applyManualSetup({
      turn: "player",
      phase: "battle",
      player: {
        field: [
          { name: "Shadow-Heart Scale Dragon", position: "attack" },
        ],
        spellTrap: ["Mirror Force"],
      },
      bot: {
        field: [
          { name: "Void Hydra Titan", position: "defense" },
          { name: "Void Hydra Titan", position: "attack" },
        ],
      },
    });

    if (!setupResult.success) {
      return setupResult;
    }

    const attacker = this.player.field.find(Boolean);
    const battleTarget = this.bot.field.find(
      (card) => card && card.name === "Void Hydra Titan" && card.position === "defense"
    );
    const effectTarget = this.bot.field.find(
      (card) => card && card.name === "Void Hydra Titan" && card.position === "attack"
    );
    const mirrorForce = this.player.spellTrap.find(
      (card) => card && card.name === "Mirror Force"
    );

    if (!attacker || !battleTarget || !effectTarget || !mirrorForce) {
      return { success: false, reason: "Sanity H setup missing cards." };
    }

    const battleAtkBefore = battleTarget.atk;
    const effectAtkBefore = effectTarget.atk;

    const battleResult = await this.destroyCard(battleTarget, {
      cause: "battle",
      sourceCard: attacker,
      opponent: this.player,
    });

    const battleNegated = battleResult?.negated === true;
    const battleSurvived = this.bot.field.includes(battleTarget);
    const battleAtkReduced = battleTarget.atk === battleAtkBefore - 700;

    const mirrorResult = await this.effectEngine.applyMirrorForceDestroy(
      {},
      {
        game: this,
        player: this.player,
        source: mirrorForce,
        card: mirrorForce,
        eventData: { attacker },
      }
    );

    const effectSurvived = this.bot.field.includes(effectTarget);
    const effectAtkReduced = effectTarget.atk === effectAtkBefore - 700;
    const effectNegated = effectSurvived && effectAtkReduced;

    const cleanupState = this.devGetSelectionCleanupState();
    const cleanupOk =
      !cleanupState.selectionActive &&
      !cleanupState.controlsVisible &&
      cleanupState.highlightCount === 0;

    const success =
      battleNegated &&
      battleSurvived &&
      battleAtkReduced &&
      effectNegated &&
      cleanupOk &&
      mirrorResult === true;

    this.devLog("SANITY_H_RESULT", {
      summary: "Sanity H result",
      battleNegated,
      battleSurvived,
      battleAtkReduced,
      effectNegated,
      mirrorResult,
      cleanupOk,
    });

    return {
      success,
      battleNegated,
      battleSurvived,
      battleAtkReduced,
      effectNegated,
      mirrorResult,
      cleanupOk,
    };
  }

  applyManualSetup(definition = {}) {
    if (!this.devModeEnabled) {
      return { success: false, reason: "Dev Mode is disabled." };
    }
    if (!definition || typeof definition !== "object") {
      return { success: false, reason: "Setup must be an object." };
    }

    const warnings = [];
    const normalizeEntry = (entry) => {
      if (typeof entry === "string") return { name: entry };
      if (entry && typeof entry === "object") return { ...entry };
      return null;
    };

    const placeInZone = (player, entry, zone) => {
      const normalized = normalizeEntry(entry);
      if (!normalized) {
        warnings.push(`Invalid entry for ${zone}.`);
        return;
      }
      const card = this.createCardForOwner(normalized, player, normalized);
      if (!card) {
        warnings.push(`Card "${normalized.name || normalized.id}" not found.`);
        return;
      }

      switch (zone) {
        case "hand":
          player.hand.push(card);
          break;
        case "field":
          if (card.cardKind !== "monster") {
            warnings.push(`${card.name} is not a monster.`);
            return;
          }
          if (player.field.length >= 5) {
            warnings.push("Field is full (max 5 monsters).");
            return;
          }
          card.position =
            normalized.position === "defense" ? "defense" : "attack";
          card.hasAttacked = false;
          card.attacksUsedThisTurn = 0;
          player.field.push(card);
          break;
        case "spellTrap":
          if (card.cardKind === "monster") {
            warnings.push(`${card.name} cannot be placed in Spell/Trap zone.`);
            return;
          }
          if (player.spellTrap.length >= 5) {
            warnings.push("Spell/Trap zone is full (max 5 cards).");
            return;
          }
          player.spellTrap.push(card);
          break;
        case "graveyard":
          player.graveyard.push(card);
          break;
        case "fieldSpell":
          if (card.cardKind !== "spell" || card.subtype !== "field") {
            warnings.push(`${card.name} is not a Field Spell.`);
            return;
          }
          player.fieldSpell = card;
          break;
        case "extraDeck":
          player.extraDeck.push(card);
          break;
        case "deck":
          player.deck.push(card);
          break;
        default:
          warnings.push(`Unsupported zone "${zone}".`);
      }
    };

    const resetSide = (player) => {
      player.hand = [];
      player.field = [];
      player.spellTrap = [];
      player.graveyard = [];
      player.fieldSpell = null;
      player.oncePerTurnUsageByName = {};
    };

    const applySide = (player, payload = {}) => {
      if (!payload || typeof payload !== "object") return;

      resetSide(player);

      if (typeof payload.lp === "number" && Number.isFinite(payload.lp)) {
        player.lp = Math.max(0, Math.floor(payload.lp));
      }

      if (Array.isArray(payload.hand)) {
        payload.hand.forEach((entry) => placeInZone(player, entry, "hand"));
      }

      if (Array.isArray(payload.field)) {
        payload.field.forEach((entry) => placeInZone(player, entry, "field"));
      }

      if (Array.isArray(payload.spellTrap)) {
        payload.spellTrap.forEach((entry) =>
          placeInZone(player, entry, "spellTrap")
        );
      }

      if (Array.isArray(payload.graveyard)) {
        payload.graveyard.forEach((entry) =>
          placeInZone(player, entry, "graveyard")
        );
      }

      if (payload.fieldSpell) {
        placeInZone(player, payload.fieldSpell, "fieldSpell");
      }

      if (Array.isArray(payload.extraDeck)) {
        player.extraDeck = [];
        payload.extraDeck.forEach((entry) =>
          placeInZone(player, entry, "extraDeck")
        );
      }

      if (Array.isArray(payload.deck)) {
        player.deck = [];
        payload.deck.forEach((entry) => placeInZone(player, entry, "deck"));
      }

      if (Array.isArray(payload.deckTop) && payload.deckTop.length > 0) {
        for (let i = payload.deckTop.length - 1; i >= 0; i--) {
          placeInZone(player, payload.deckTop[i], "deck");
        }
      }
    };

    if (definition.player) {
      applySide(this.player, definition.player);
    }
    if (definition.bot) {
      applySide(this.bot, definition.bot);
    }

    if (typeof definition.turn === "string") {
      this.turn = definition.turn === "bot" ? "bot" : "player";
    }
    if (typeof definition.phase === "string") {
      this.phase = definition.phase;
    }

    this.gameOver = false;
    this.isResolvingEffect = false;
    this.pendingSpecialSummon = null;
    this.cancelTargetSelection();
    this.effectEngine?.updatePassiveBuffs();
    this.updateBoard();
    if (this.renderer?.log) {
      this.renderer.log("Dev setup applied.");
    }
    this.devLog("DEV_SETUP_APPLIED", {
      summary: "Manual setup applied",
      warnings: warnings.length,
    });
    return { success: true, warnings };
  }
}
