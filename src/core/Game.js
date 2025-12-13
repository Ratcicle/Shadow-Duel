import Player from "./Player.js";
import Bot from "./Bot.js";
import Renderer from "../ui/Renderer.js";
import EffectEngine from "./EffectEngine.js";

export default class Game {
  constructor() {
    this.player = new Player("player", "You");
    this.bot = new Bot("shadowheart");
    this.renderer = new Renderer();
    this.effectEngine = new EffectEngine(this);

    this.player.game = this;
    this.bot.game = this;

    this.turn = "player";
    this.phase = "draw";
    this.turnCounter = 0;
    this.gameOver = false;
    this.targetSelection = null;
    this.graveyardSelection = null;
    this.eventListeners = {};
    this.phaseDelayMs = 400;
    this.lastAttackNegated = false;
    this.pendingSpecialSummon = null; // Track pending special summon (e.g., Leviathan from Eel)
    this.isResolvingEffect = false; // Lock player actions while resolving an effect
    this.trapPromptInProgress = false; // Evita múltiplos modais de armadilha simultâneos
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

  updateBoard() {
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

    if (this.targetSelection) {
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
    title.textContent = card ? card.name : "Activate effect?";
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
    console.log(`[Game] bindCardInteractions called`);
    console.log(
      `[Game] player-spelltrap element:`,
      document.getElementById("player-spelltrap")
    );

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
          this.tryActivateSpell(card, index);
          return;
        }

        // Special check for Polymerization
        if (card.name === "Polymerization") {
          if (!this.canActivatePolymerization()) {
            this.renderer.log(
              "Cannot activate Polymerization: No valid Fusion Summons available."
            );
            return;
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
          this.renderer.showSpellChoiceModal(index, handleSpellChoice);
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
          this.handleTargetSelectionClick("player", index, cardEl)
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

          const wasAlreadyAttacked = attacker.hasAttacked;

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

          if (wasAlreadyAttacked && canUseSecondAttack) {
            attacker.secondAttackUsedThisTurn = true;
          }
        }
      });

    const playerSpellTrapEl = document.getElementById("player-spelltrap");
    if (playerSpellTrapEl) {
      playerSpellTrapEl.addEventListener("click", async (e) => {
        console.log(`[Game] Spell/Trap zone clicked! Target:`, e.target);

        if (this.targetSelection) {
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
          if (card.subtype === "continuous" || hasIgnition) {
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

      this.handleTargetSelectionClick("bot", index, cardEl);
    });

    // Direcionar ataque direto: clicar na mão do oponente quando houver alvo "Direct Attack"
    const botHandEl = document.getElementById("bot-hand");
    if (botHandEl) {
      botHandEl.addEventListener("click", (e) => {
        if (!this.targetSelection) return;
        if (this.targetSelection.kind !== "attack") return;
        const option = this.targetSelection.options[0];
        if (!option) return;

        const directCandidate = option.candidates.find(
          (c) => c && c.isDirectAttack
        );
        if (!directCandidate) return;

        // Seleciona o índice do ataque direto e finaliza seleção
        this.targetSelection.selections[option.id] = [directCandidate.idx];
        this.targetSelection.currentOption =
          this.targetSelection.options.length;
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
          this.handleTargetSelectionClick("player", 0, cardEl);
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
        this.handleTargetSelectionClick("bot", 0, cardEl);
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

    // Check for Equip Spell protection (e.g., Crescent Shield Guard)
    if (options.reason === "battle") {
      const guardEquip = (card.equips || []).find(
        (equip) =>
          equip && equip.grantsCrescentShieldGuard && equip.equippedTo === card
      );

      if (guardEquip) {
        this.renderer.log(
          `${guardEquip.name} was destroyed to protect ${card.name}.`
        );
        this.moveCard(guardEquip, ownerPlayer, "graveyard", {
          fromZone: "spellTrap",
        });
        guardEquip.grantsCrescentShieldGuard = false;
        return { replaced: true };
      }
    }

    // Generic destruction replacement system
    // Look for effects with replacementEffect property
    const replacementEffect = (card.effects || []).find(
      (eff) => eff.replacementEffect && eff.replacementEffect.type === "destruction"
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
    if (replacement.reason && replacement.reason !== "any" && replacement.reason !== options.reason) {
      return { replaced: false };
    }

    // Build filter function for cost candidates
    const costFilters = replacement.costFilters || {};
    const filterCandidates = (candidate) => {
      if (!candidate || candidate === card) return false;

      if (costFilters.cardKind && candidate.cardKind !== costFilters.cardKind) return false;

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
        this.moveCard(costCard, ownerPlayer, "graveyard", { fromZone: costZone });
      }

      this.effectEngine.registerOncePerTurnUsage(card, ownerPlayer, replacementEffect);

      const costNames = chosen.map(c => c.name).join(", ");
      this.renderer.log(
        `${card.name} avoided destruction by sending ${costNames} to the Graveyard.`
      );
      return { replaced: true };
    }

    // Player confirmation
    const costArchetype = costFilters.archetype || "monster";
    const prompt = replacement.prompt || 
      `Send ${costCount} "${costArchetype}" ${costCount > 1 ? 'monsters' : 'monster'} to the GY to save ${card.name}?`;
    
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
      message: replacement.selectionMessage || 
        `Choose ${costCount} ${costCount > 1 ? 'cards' : 'card'} to send to the Graveyard for ${card.name}'s protection.`,
    });

    if (!selections || selections.length < costCount) {
      this.renderer.log("Protection cancelled.");
      return { replaced: false };
    }

    // Pay cost
    for (const costCard of selections) {
      this.moveCard(costCard, ownerPlayer, "graveyard", { fromZone: costZone });
    }

    this.effectEngine.registerOncePerTurnUsage(card, ownerPlayer, replacementEffect);

    const costNames = selections.map(c => c.name).join(", ");
    this.renderer.log(
      `${card.name} avoided destruction by sending ${costNames} to the Graveyard.`
    );
    return { replaced: true };
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

  handleSpellActivationResult(card, handIndex, result, activationZone = null) {
    if (result.needsSelection) {
      if (this.canUseFieldTargeting(result.options)) {
        this.startTargetSelection(
          card,
          handIndex,
          result.options,
          activationZone
        );
      } else {
        this.renderer.showTargetSelection(
          result.options,
          (chosenMap) => {
            const finalResult = this.effectEngine.activateFromHand(
              card,
              this.player,
              handIndex,
              chosenMap,
              activationZone
            );
            this.handleSpellActivationResult(
              card,
              handIndex,
              finalResult,
              activationZone
            );
          },
          () => {
            this.cancelTargetSelection();
          }
        );
      }
      return;
    }

    if (!result.success) {
      if (result.reason) {
        this.renderer.log(result.reason);
      }
      return;
    }

    this.renderer.log(`${card.name} activated.`);
    this.updateBoard();
  }

  handleFieldSpellActivationResult(card, owner, result) {
    if (result.needsSelection) {
      if (this.canUseFieldTargeting(result.options)) {
        this.startFieldSpellTargetSelection(card, owner, result.options);
      } else {
        this.renderer.showTargetSelection(
          result.options,
          (chosenMap) => {
            const finalResult = this.effectEngine.activateFieldSpell(
              card,
              owner,
              chosenMap
            );
            this.handleFieldSpellActivationResult(card, owner, finalResult);
          },
          () => {
            this.cancelTargetSelection();
          }
        );
      }
      return;
    }

    if (!result.success) {
      if (result.reason) {
        this.renderer.log(result.reason);
      }
      return;
    }

    this.renderer.log(`${card.name} field effect activated.`);
    this.updateBoard();
  }

  handleSpellTrapActivationResult(card, owner, result, activationZone = null) {
    if (result.needsSelection) {
      if (this.canUseFieldTargeting(result.options)) {
        this.startSpellTrapTargetSelection(
          card,
          result.options,
          activationZone
        );
      } else {
        this.renderer.showTargetSelection(
          result.options,
          async (chosenMap) => {
            const finalResult = await this.effectEngine.activateSpellTrapEffect(
              card,
              owner,
              chosenMap,
              activationZone
            );
            this.handleSpellTrapActivationResult(
              card,
              owner,
              finalResult,
              activationZone
            );
          },
          () => {
            this.cancelTargetSelection();
          }
        );
      }
      return;
    }

    if (!result.success) {
      if (result.reason) {
        this.renderer.log(result.reason);
      }
      return;
    }

    this.renderer.log(`${card.name} effect activated.`);
    this.updateBoard();
  }

  tryActivateMonsterEffect(card, selections = null, activationZone = "field") {
    if (!card) return;
    console.log(
      `[Game] tryActivateMonsterEffect called for: ${card.name} (zone: ${activationZone})`
    );
    const result = this.effectEngine.activateMonsterEffect(
      card,
      this.player,
      selections,
      activationZone
    );
    console.log(`[Game] Monster effect result:`, result);
    this.handleMonsterEffectActivationResult(
      card,
      this.player,
      result,
      activationZone
    );
  }

  handleMonsterEffectActivationResult(
    card,
    owner,
    result,
    activationZone = null
  ) {
    if (result.needsSelection) {
      if (this.canUseFieldTargeting(result.options)) {
        this.startMonsterEffectTargetSelection(
          card,
          result.options,
          activationZone
        );
      } else {
        this.renderer.showTargetSelection(
          result.options,
          (chosenMap) => {
            const finalResult = this.effectEngine.activateMonsterEffect(
              card,
              owner,
              chosenMap,
              activationZone
            );
            this.handleMonsterEffectActivationResult(
              card,
              owner,
              finalResult,
              activationZone
            );
          },
          () => {
            this.cancelTargetSelection();
          }
        );
      }
      return;
    }

    if (!result.success) {
      if (result.reason) {
        this.renderer.log(result.reason);
      }
      return;
    }

    this.renderer.log(`${card.name} effect activated.`);
    this.updateBoard();
  }

  handleGraveyardEffectActivationResult(card, owner, result) {
    if (result.needsSelection) {
      this.closeGraveyardModal(false);
      if (this.canUseFieldTargeting(result.options)) {
        this.startGraveyardEffectTargetSelection(card, owner, result.options);
      } else {
        this.renderer.showTargetSelection(
          result.options,
          (chosenMap) => {
            const finalResult = this.effectEngine.activateMonsterFromGraveyard(
              card,
              owner,
              chosenMap
            );
            this.handleGraveyardEffectActivationResult(
              card,
              owner,
              finalResult
            );
          },
          () => {
            this.cancelTargetSelection();
          }
        );
      }
      return;
    }

    if (!result.success) {
      if (result.reason) {
        this.renderer.log(result.reason);
      }
      return;
    }

    this.closeGraveyardModal(false);
    this.renderer.log(`${card.name} activates from the Graveyard.`);
    this.updateBoard();
  }

  startMonsterEffectTargetSelection(card, options, activationZone = null) {
    this.cancelTargetSelection();
    this.targetSelection = {
      kind: "monsterEffect",
      card,
      options,
      selections: {},
      currentOption: 0,
      activationZone,
    };
    console.log("[Game] Started monster effect target selection");
    this.highlightTargetCandidates();
  }

  startGraveyardEffectTargetSelection(card, owner, options) {
    this.cancelTargetSelection();
    this.targetSelection = {
      kind: "graveyardEffect",
      card,
      owner,
      options,
      selections: {},
      currentOption: 0,
    };
    this.renderer.log("Select target(s) for the graveyard effect.");
    this.highlightTargetCandidates();
  }

  startSpellTrapTargetSelection(card, options, activationZone = null) {
    this.cancelTargetSelection();
    this.targetSelection = {
      kind: "spellTrapEffect",
      card,
      options,
      selections: {},
      currentOption: 0,
      activationZone,
    };
    this.renderer.log("Select target(s) for the continuous spell effect.");
    this.highlightTargetCandidates();
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

    const result = await this.effectEngine.activateSpellTrapEffect(
      card,
      this.player,
      selections,
      "spellTrap"
    );
    console.log(`[Game] Result:`, result);
    this.handleSpellTrapActivationResult(
      card,
      this.player,
      result,
      "spellTrap"
    );
  }

  canUseFieldTargeting(options) {
    if (!options || options.length === 0) return false;
    return options.every(
      (opt) =>
        opt.min === opt.max &&
        opt.candidates.length > 0 &&
        opt.candidates.every(
          (cand) =>
            (cand.zone === "field" || cand.zone === "fieldSpell") &&
            (cand.controller === "player" || cand.controller === "bot")
        )
    );
  }

  activateFieldSpellEffect(card) {
    const owner = card.owner === "player" ? this.player : this.bot;
    const result = this.effectEngine.activateFieldSpell(card, owner);
    this.handleFieldSpellActivationResult(card, owner, result);
  }

  startTargetSelection(card, handIndex, options, activationZone = null) {
    this.cancelTargetSelection();
    this.targetSelection = {
      kind: "spell",
      card,
      handIndex,
      options,
      selections: {},
      currentOption: 0,
      activationZone,
    };
    this.renderer.log("Select target(s) by clicking the highlighted monsters.");
    this.highlightTargetCandidates();
  }

  startFieldSpellTargetSelection(card, owner, options) {
    this.cancelTargetSelection();
    this.targetSelection = {
      kind: "fieldSpell",
      card,
      owner,
      options,
      selections: {},
      currentOption: 0,
    };
    this.renderer.log("Select target(s) for the field spell effect.");
    this.highlightTargetCandidates();
  }

  startTriggeredTargetSelection(card, effect, ctx, options) {
    if (this.canUseFieldTargeting(options)) {
      this.cancelTargetSelection();
      this.targetSelection = {
        kind: "triggered",
        card,
        effect,
        ctx,
        options,
        selections: {},
        currentOption: 0,
      };
      this.renderer.log(
        "Select target(s) for triggered effect by clicking the highlighted monsters."
      );
      this.highlightTargetCandidates();
    } else {
      this.renderer.showTargetSelection(
        options,
        (chosenMap) => {
          this.effectEngine.resolveTriggeredSelection(effect, ctx, chosenMap);
          this.updateBoard();
        },
        () => {
          this.cancelTargetSelection();
        }
      );
    }
  }

  startAttackTargetSelection(attacker, candidates) {
    if (!attacker || !Array.isArray(candidates)) return;
    if (candidates.length === 0 && !attacker.canAttackDirectlyThisTurn) return;
    this.cancelTargetSelection();
    const decorated = candidates.map((card, idx) => {
      const ownerLabel = card.owner === "player" ? "player" : "opponent";
      const ownerPlayer = card.owner === "player" ? this.player : this.bot;
      const zoneArr = this.getZone(ownerPlayer, "field") || [];
      const zoneIndex = zoneArr.indexOf(card);
      return {
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
      });
    }

    this.targetSelection = {
      kind: "attack",
      attacker,
      options: [
        {
          id: "attack_target",
          min: 1,
          max: 1,
          zone: "field",
          candidates: decorated,
        },
      ],
      selections: {},
      currentOption: 0,
    };
    this.renderer.log("Select a monster to attack.");
    this.highlightTargetCandidates();
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
      this.cancelTargetSelection();
      this.targetSelection = {
        kind: "custom",
        options: [
          {
            id: "custom_select",
            zone: zoneName,
            min,
            max,
            candidates: decorated,
          },
        ],
        selections: {},
        currentOption: 0,
        resolve,
      };
      this.renderer.log(
        config.message || "Select card(s) by clicking the highlighted targets."
      );
      this.highlightTargetCandidates();
    });
  }

  highlightTargetCandidates() {
    this.clearTargetHighlights();
    if (!this.targetSelection) {
      console.log("[Game] No target selection active");
      return;
    }
    const option =
      this.targetSelection.options[this.targetSelection.currentOption];
    if (!option) {
      console.log("[Game] No option to highlight");
      return;
    }

    console.log("[Game] Highlighting targets:", {
      kind: this.targetSelection.kind,
      optionId: option.id,
      candidatesCount: option.candidates?.length,
      min: option.min,
      max: option.max,
    });

    option.candidates.forEach((cand) => {
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
      const selected = this.targetSelection.selections[option.id] || [];
      if (selected.includes(cand.idx)) {
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

  handleTargetSelectionClick(ownerId, cardIndex, cardEl) {
    if (!this.targetSelection) return false;

    console.log("[Game] Target selection click:", {
      ownerId,
      cardIndex,
      currentOption: this.targetSelection.currentOption,
      optionsLength: this.targetSelection.options?.length,
    });

    const option =
      this.targetSelection.options[this.targetSelection.currentOption];
    if (!option) {
      console.log("[Game] No option found");
      return false;
    }

    const ownerPlayer = ownerId === "player" ? this.player : this.bot;
    let card = null;

    if (option.zone === "fieldSpell") {
      card = ownerPlayer.fieldSpell;
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
      candidatesCount: option.candidates.length,
      candidateNames: option.candidates.map(
        (c) => `${c.name} [idx:${c.zoneIndex}]`
      ),
    });

    // Find candidate by matching card reference (most reliable method)
    // NOTE: We use cardRef identity match instead of zoneIndex because
    // zoneIndex can become stale if the board is re-rendered between
    // when decoratedCandidates were created and when the click occurs
    const candidate = option.candidates.find((cand) => cand.cardRef === card);

    if (!candidate) {
      console.log("[Game] Candidate not found. Checking references:");
      option.candidates.forEach((cand, i) => {
        console.log(`  Candidate ${i}:`, {
          name: cand.name,
          zoneIndex: cand.zoneIndex,
          cardIndex: cardIndex,
          refMatch: cand.cardRef === card,
        });
      });
      return true;
    }

    const selections = this.targetSelection.selections[option.id] || [];
    const max = Number(option.max ?? 0);
    const existing = selections.indexOf(candidate.idx);
    if (existing > -1) {
      selections.splice(existing, 1);
      cardEl.classList.remove("selected-target");
      console.log("[Game] Deselected card");
    } else {
      if (max > 0 && selections.length >= max) {
        console.log("[Game] Max selections reached");
        return true;
      }
      selections.push(candidate.idx);
      cardEl.classList.add("selected-target");
      console.log(
        "[Game] Selected card, total:",
        selections.length,
        "/",
        max || option.max
      );
    }
    this.targetSelection.selections[option.id] = selections;

    if (max > 0 && selections.length >= max) {
      console.log("[Game] Max reached, advancing selection");
      this.advanceTargetSelection();
    }

    return true;
  }

  advanceTargetSelection() {
    if (!this.targetSelection) return;
    const option =
      this.targetSelection.options[this.targetSelection.currentOption];
    if (!option) return;

    const selections = this.targetSelection.selections[option.id] || [];
    if (selections.length < option.min) {
      return;
    }

    this.targetSelection.currentOption++;
    if (
      this.targetSelection.currentOption >= this.targetSelection.options.length
    ) {
      this.finishTargetSelection();
    } else {
      this.highlightTargetCandidates();
    }
  }

  async finishTargetSelection() {
    if (!this.targetSelection) return;
    const selection = this.targetSelection;
    this.targetSelection = null;
    this.graveyardSelection = null;
    this.clearTargetHighlights();

    if (selection.kind === "spell") {
      const result = this.effectEngine.activateFromHand(
        selection.card,
        this.player,
        selection.handIndex,
        selection.selections,
        selection.activationZone
      );

      this.handleSpellActivationResult(
        selection.card,
        selection.handIndex,
        result,
        selection.activationZone
      );
    } else if (selection.kind === "fieldSpell") {
      const owner = selection.owner;
      const result = this.effectEngine.activateFieldSpell(
        selection.card,
        owner,
        selection.selections
      );
      this.handleFieldSpellActivationResult(selection.card, owner, result);
    } else if (selection.kind === "spellTrapEffect") {
      const result = await this.effectEngine.activateSpellTrapEffect(
        selection.card,
        this.player,
        selection.selections,
        selection.activationZone
      );
      this.handleSpellTrapActivationResult(
        selection.card,
        this.player,
        result,
        selection.activationZone
      );
    } else if (selection.kind === "monsterEffect") {
      const result = this.effectEngine.activateMonsterEffect(
        selection.card,
        this.player,
        selection.selections,
        selection.activationZone
      );
      this.handleMonsterEffectActivationResult(
        selection.card,
        this.player,
        result,
        selection.activationZone
      );
    } else if (selection.kind === "graveyardEffect") {
      const owner = selection.owner || this.player;
      const result = this.effectEngine.activateMonsterFromGraveyard(
        selection.card,
        owner,
        selection.selections
      );
      this.handleGraveyardEffectActivationResult(
        selection.card,
        owner,
        result
      );
    } else if (selection.kind === "triggered") {
      this.effectEngine.resolveTriggeredSelection(
        selection.effect,
        selection.ctx,
        selection.selections
      );
      this.updateBoard();
    } else if (selection.kind === "attack") {
      const option = selection.options[0];
      if (option) {
        const chosenIndexes = selection.selections[option.id] || [];
        const chosenCandidate = option.candidates[chosenIndexes[0]];
        const chosenCard = chosenCandidate?.cardRef ?? null;
        const isDirectAttack = chosenCandidate?.isDirectAttack === true;
        if (isDirectAttack) {
          this.resolveCombat(selection.attacker, null).catch((err) =>
            console.error(err)
          );
        } else if (chosenCard) {
          this.resolveCombat(selection.attacker, chosenCard).catch((err) =>
            console.error(err)
          );
        }
      }
    } else if (selection.kind === "custom") {
      const option = selection.options[0];
      const chosen = (selection.selections[option.id] || [])
        .map((idx) => option.candidates[idx]?.cardRef)
        .filter(Boolean);
      if (selection.resolve) {
        selection.resolve(chosen);
      }
    }
  }

  cancelTargetSelection() {
    if (!this.targetSelection) return;
    const selection = this.targetSelection;
    if (selection?.resolve) {
      selection.resolve([]);
    }
    this.clearTargetHighlights();
    this.targetSelection = null;
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
          const result = this.effectEngine.activateMonsterFromGraveyard(
            card,
            player
          );
          this.handleGraveyardEffectActivationResult(card, player, result);
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
          const { replaced } =
            (await this.resolveDestructionWithReplacement(target, {
              reason: "battle",
              sourceCard: attacker,
            })) || {};
          if (!replaced) {
            this.moveCard(target, defender, "graveyard", {
              fromZone: "field",
              wasDestroyed: true,
            });
            this.applyBattleDestroyEffect(attacker, target);
          }
        }
      } else if (attacker.atk < target.atk) {
        const attPlayer = attacker.owner === "player" ? this.player : this.bot;
        const damage = target.atk - attacker.atk;
        applyBattleDamage(attPlayer, attacker, damage);

        logBattleDestroyCheck("attacker loses to atk target");
        if (this.canDestroyByBattle(attacker)) {
          const { replaced } =
            (await this.resolveDestructionWithReplacement(attacker, {
              reason: "battle",
              sourceCard: target,
            })) || {};
          if (!replaced) {
            this.moveCard(attacker, attPlayer, "graveyard");
            this.applyBattleDestroyEffect(attacker, attacker);
          }
        }
      } else {
        const attPlayer = attacker.owner === "player" ? this.player : this.bot;
        const defPlayer = target.owner === "player" ? this.player : this.bot;

        logBattleDestroyCheck("tie - attacker destruction check");
        if (this.canDestroyByBattle(attacker)) {
          const { replaced } =
            (await this.resolveDestructionWithReplacement(attacker, {
              reason: "battle",
              sourceCard: target,
            })) || {};
          if (!replaced) {
            this.moveCard(attacker, attPlayer, "graveyard", {
              fromZone: "field",
              wasDestroyed: true,
            });
            this.applyBattleDestroyEffect(attacker, attacker);
          }
        }

        logBattleDestroyCheck("tie - target destruction check");
        if (this.canDestroyByBattle(target)) {
          const { replaced } =
            (await this.resolveDestructionWithReplacement(target, {
              reason: "battle",
              sourceCard: attacker,
            })) || {};
          if (!replaced) {
            this.moveCard(target, defPlayer, "graveyard", {
              fromZone: "field",
              wasDestroyed: true,
            });
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
          const { replaced } =
            (await this.resolveDestructionWithReplacement(target, {
              reason: "battle",
              sourceCard: attacker,
            })) || {};
          if (!replaced) {
            this.moveCard(target, defender, "graveyard", {
              fromZone: "field",
              wasDestroyed: true,
            });
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
      if (this.effectEngine.canSummonFusion(fusion, availableMaterials, this.player)) {
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
      const prevBuff = card.voidTenebrisBuffValue || 0;
      if (prevBuff) {
        card.atk -= prevBuff;
        card.def -= prevBuff;
      }
      card.voidTenebrisBuffValue = 0;
      if (this.effectEngine) {
        this.effectEngine.updateVoidTenebrisHornBuffs();
      }
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
        this.renderer.log(
          `${host.name} is destroyed as ${card.name} left the field.`
        );
        const hostOwner = host.owner === "player" ? this.player : this.bot;
        const hostFieldIndex = hostOwner.field.indexOf(host);
        if (hostFieldIndex > -1) {
          hostOwner.field.splice(hostFieldIndex, 1);
          hostOwner.graveyard.push(host);
        }
        card.equippedTo = null;
        this.updateBoard();
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
        const trapIndex = fromOwner.spellTrap.indexOf(callTrap);
        if (trapIndex > -1) {
          fromOwner.spellTrap.splice(trapIndex, 1);
          fromOwner.graveyard.push(callTrap);
          this.renderer.log(
            `${callTrap.name} was destroyed as ${card.name} left the field.`
          );
        }
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
      const monsterIndex = monsterOwner.field.indexOf(revivedMonster);
      if (monsterIndex > -1) {
        monsterOwner.field.splice(monsterIndex, 1);
        monsterOwner.graveyard.push(revivedMonster);
        this.renderer.log(
          `${revivedMonster.name} was destroyed as ${card.name} left the field.`
        );
      }
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

  tryActivateSpell(card, handIndex, selections = null, options = {}) {
    if (this.targetSelection) return;

    const result = this.effectEngine.activateFromHand(
      card,
      this.player,
      handIndex,
      selections,
      options.activationZone
    );

    this.handleSpellActivationResult(
      card,
      handIndex,
      result,
      options.activationZone
    );
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
      this.trapPromptInProgress = false;
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
}
