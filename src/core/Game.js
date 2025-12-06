import Player from "./Player.js";
import Bot from "./Bot.js";
import Renderer from "../ui/Renderer.js";
import EffectEngine from "./EffectEngine.js";

export default class Game {
  constructor() {
    this.player = new Player("player", "You");
    this.bot = new Bot();
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
  }

  on(eventName, handler) {
    if (!this.eventListeners[eventName]) {
      this.eventListeners[eventName] = [];
    }
    this.eventListeners[eventName].push(handler);
  }

  emit(eventName, payload) {
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
  }

  start(deckList = null) {
    this.player.buildDeck(deckList);
    for (let i = 0; i < 4; i++) {
      this.player.ensureCardOnTop("Infinity Searcher", true);
    }
    this.bot.buildDeck();

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

    if (this.targetSelection) {
      this.highlightTargetCandidates();
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

    const wantsAttack = window.confirm(
      "Special Summon em ATAQUE? (OK = Ataque, Cancelar = Defesa)"
    );
    return wantsAttack ? "attack" : "defense";
  }

  async startTurn() {
    this.turnCounter += 1;
    this.phase = "draw";

    const activePlayer = this.turn === "player" ? this.player : this.bot;
    const opponent = activePlayer === this.player ? this.bot : this.player;
    activePlayer.field.forEach((card) => {
      card.hasAttacked = false;
      card.attacksUsedThisTurn = 0;
      card.cannotAttackThisTurn = false;
      card.positionChangedThisTurn = false;
      card.canMakeSecondAttackThisTurn = false;
      card.secondAttackUsedThisTurn = false;
      card.battleIndestructibleOncePerTurnUsed = false;
    });
    activePlayer.summonCount = 0;

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

  nextPhase() {
    if (this.gameOver) return;

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
          this.renderer.log(`Not enough tributes for Level ${card.level} monster.`);
          return;
        }

        this.renderer.showSummonModal(index, (choice) => {
          if (choice === "special_from_aegisbearer") {
            this.specialSummonSanctumProtectorFromHand(index);
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

              this.renderer.log(`Select ${tributesNeeded} monster(s) to tribute.`);
            } else {
              const before = this.player.field.length;
              const result = this.player.summon(index, position, isFacedown);
              if (!result && this.player.field.length === before) {
                this.updateBoard();
                return;
              }
              const summonedCard = this.player.field[this.player.field.length - 1];
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
        }, { canSanctumSpecialFromAegis });
        return;
      }

      if (card.cardKind === "spell") {
        if (this.phase !== "main1" && this.phase !== "main2") {
          this.tryActivateSpell(card, index);
          return;
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

    document.getElementById("player-field").addEventListener("click", (e) => {
      const cardEl = e.target.closest(".card");
      if (!cardEl) return;

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

          const summonedCard = this.player.field[this.player.field.length - 1];
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
        if (
          card &&
          card.cardKind === "monster" &&
          card.effects &&
          card.effects[0] &&
          card.effects[0].timing === "ignition"
        ) {
          this.showIgnitionActivateModal(card, () => {
            const result = this.effectEngine.activateMonsterFromField(
              card,
              this.player,
              index
            );
            if (result.success) {
              this.updateBoard();
            } else if (result.reason) {
              this.renderer.log(result.reason);
            }
          });
          return;
        }
        const canFlip = card ? this.canFlipSummon(card) : false;
        const canPosChange = card ? this.canChangePosition(card) : false;

        if (card && (canFlip || canPosChange)) {
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
            { canFlip, canChangePosition: canPosChange }
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

        let target = null;
        const tauntTargets = this.bot.field.filter(
          (card) =>
            card &&
            card.cardKind === "monster" &&
            !card.isFacedown &&
            card.mustBeAttacked
        );

        if (tauntTargets.length > 0) {
          target = tauntTargets[0];
        } else if (this.bot.field.length > 0) {
          target = this.bot.field[0];
        }
        this.resolveCombat(attacker, target);
        if (wasAlreadyAttacked && canUseSecondAttack) {
          attacker.secondAttackUsedThisTurn = true;
        }
      }
    });

    const playerSpellTrapEl = document.getElementById("player-spelltrap");
    if (playerSpellTrapEl) {
      playerSpellTrapEl.addEventListener("click", (e) => {
        if (this.targetSelection) return;
        if (this.turn !== "player") return;
        if (this.phase !== "main1" && this.phase !== "main2") return;

        const cardEl = e.target.closest(".card");
        if (!cardEl) return;

        const index = parseInt(cardEl.dataset.index);
        if (Number.isNaN(index)) return;

        const card = this.player.spellTrap[index];
        if (!card) return;

        if (card.cardKind !== "spell") return;
        if (!card.isFacedown) return;

        const onActivate = () => {
          card.isFacedown = false;
          this.updateBoard();
          this.tryActivateSpell(card, null, null, {
            activationZone: "spellTrap",
          });
        };

        if (
          this.renderer &&
          typeof this.renderer.showSpellActivateModal === "function"
        ) {
          this.renderer.showSpellActivateModal(cardEl, onActivate);
        } else {
          onActivate();
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

    document.querySelector(".close-modal").addEventListener("click", () => {
      this.closeGraveyardModal();
    });

    window.addEventListener("click", (e) => {
      const modal = document.getElementById("gy-modal");
      if (e.target === modal) {
        this.closeGraveyardModal();
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

    card.position = "attack";
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
        this.startTargetSelection(card, handIndex, result.options, activationZone);
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

  highlightTargetCandidates() {
    this.clearTargetHighlights();
    if (!this.targetSelection) return;
    const option =
      this.targetSelection.options[this.targetSelection.currentOption];
    if (!option) return;

    option.candidates.forEach((cand) => {
      let fieldSelector = null;
      if (cand.zone === "field") {
        fieldSelector =
          cand.controller === "player" ? "#player-field" : "#bot-field";
      } else if (cand.zone === "fieldSpell") {
        fieldSelector =
          cand.controller === "player"
            ? "#player-fieldspell"
            : "#bot-fieldspell";
      }

      if (!fieldSelector) return;

      const indexSelector =
        cand.zone === "fieldSpell" ? " .card" : ` .card[data-index="${cand.zoneIndex}"]`;
      const cardEl = document.querySelector(`${fieldSelector}${indexSelector}`);
      if (cardEl) {
        cardEl.classList.add("targetable");
        const selected = this.targetSelection.selections[option.id] || [];
        if (selected.includes(cand.idx)) {
          cardEl.classList.add("selected-target");
        }
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
  }

  handleTargetSelectionClick(ownerId, cardIndex, cardEl) {
    if (!this.targetSelection) return false;
    const option =
      this.targetSelection.options[this.targetSelection.currentOption];
    if (!option) return false;

    const ownerPlayer = ownerId === "player" ? this.player : this.bot;
    let card = null;

    if (option.zone === "fieldSpell") {
      card = ownerPlayer.fieldSpell;
    } else {
      card = ownerPlayer.field[cardIndex];
    }

    if (!card) return true;

    const candidate = option.candidates.find((cand) => cand.cardRef === card);
    if (!candidate) return true;

    const selections = this.targetSelection.selections[option.id] || [];
    const existing = selections.indexOf(candidate.idx);
    if (existing > -1) {
      selections.splice(existing, 1);
      cardEl.classList.remove("selected-target");
    } else {
      if (selections.length >= option.max) {
        return true;
      }
      selections.push(candidate.idx);
      cardEl.classList.add("selected-target");
    }
    this.targetSelection.selections[option.id] = selections;

    if (selections.length === option.max) {
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

  finishTargetSelection() {
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
    } else if (selection.kind === "triggered") {
      this.effectEngine.resolveTriggeredSelection(
        selection.effect,
        selection.ctx,
        selection.selections
      );
      this.updateBoard();
    }
  }

  cancelTargetSelection() {
    if (!this.targetSelection) return;
    this.clearTargetHighlights();
    this.targetSelection = null;
  }
  openGraveyardModal(player, options = {}) {
    if (options.selectable) {
      this.graveyardSelection = { onCancel: options.onCancel || null };
    } else {
      this.graveyardSelection = null;
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

  resolveCombat(attacker, target) {
    if (!attacker) return;

    const availability = this.getAttackAvailability(attacker);
    if (!availability.ok) return;

    this.lastAttackNegated = false;

    this.renderer.log(
      `${attacker.name} attacks ${target ? target.name : "directly"}!`
    );

    const attackerOwner = attacker.owner === "player" ? this.player : this.bot;
    const defenderOwner = attacker.owner === "player" ? this.bot : this.player;

    this.emit("attack_declared", {
      attacker,
      target: target || null,
      attackerOwner,
      defenderOwner,
    });

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
          this.finishCombat(attacker, target);
        }, 600);

        return;
      }

      this.finishCombat(attacker, target);
    }
  }

  finishCombat(attacker, target) {
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

    if (target.position === "attack") {
      if (attacker.atk > target.atk) {
        const defender = target.owner === "player" ? this.player : this.bot;
        const damage = attacker.atk - target.atk;
        applyBattleDamage(defender, target, damage);

        if (this.canDestroyByBattle(target)) {
          this.moveCard(target, defender, "graveyard");
          this.applyBattleDestroyEffect(attacker, target);
        }
      } else if (attacker.atk < target.atk) {
        const attPlayer = attacker.owner === "player" ? this.player : this.bot;
        const damage = target.atk - attacker.atk;
        applyBattleDamage(attPlayer, attacker, damage);

        if (this.canDestroyByBattle(attacker)) {
          this.moveCard(attacker, attPlayer, "graveyard");
          this.applyBattleDestroyEffect(attacker, attacker);
        }
      } else {
        const attPlayer = attacker.owner === "player" ? this.player : this.bot;
        const defPlayer = target.owner === "player" ? this.player : this.bot;

        if (this.canDestroyByBattle(attacker)) {
          this.moveCard(attacker, attPlayer, "graveyard");
          this.applyBattleDestroyEffect(attacker, attacker);
        }

        if (this.canDestroyByBattle(target)) {
          this.moveCard(target, defPlayer, "graveyard");
          this.applyBattleDestroyEffect(attacker, target);
        }
      }
    } else {
      const defender = target.owner === "player" ? this.player : this.bot;
      if (attacker.atk > target.def) {
        if (attacker.piercing) {
          const damage = attacker.atk - target.def;
          applyBattleDamage(defender, target, damage);
        }
        if (this.canDestroyByBattle(target)) {
          this.moveCard(target, defender, "graveyard");
          this.applyBattleDestroyEffect(attacker, target);
        }
      } else if (attacker.atk < target.def) {
        const attPlayer = attacker.owner === "player" ? this.player : this.bot;
        const damage = target.def - attacker.atk;
        applyBattleDamage(attPlayer, attacker, damage);
        if (this.canDestroyByBattle(attacker)) {
          this.moveCard(attacker, attPlayer, "graveyard");
          this.applyBattleDestroyEffect(attacker, attacker);
        }
      }
    }

    this.markAttackUsed(attacker);
    this.checkWinCondition();
    this.updateBoard();
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
      card.tempBattleIndestructible = false;
      card.battleDamageHealsControllerThisTurn = false;
    });
  }

  getZone(player, zone) {
    switch (zone) {
      case "hand":
        return player.hand;
      case "deck":
        return player.deck;
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
    }

    // Se um equip spell está saindo da spell/trap zone, limpar seus efeitos no monstro
    if (
      fromZone === "spellTrap" &&
      card.cardKind === "spell" &&
      card.subtype === "equip" &&
      card.equippedTo
    ) {
      const host = card.equippedTo;

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

      this.effectEngine.handleEvent("card_to_grave", {
        card,
        fromZone: fromZone || options.fromZone || null,
        toZone: "graveyard",
        player: ownerPlayer,
        opponent: otherPlayer,
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
    const otherPlayer = destroyedOwner === this.player ? this.bot : this.player;

    this.effectEngine.handleEvent("battle_destroy", {
      player: otherPlayer, // the player whose opponent's monster was destroyed
      opponent: destroyedOwner, // the player who lost the monster
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
}
