import Player from "./Player.js";

export default class Bot extends Player {
  constructor() {
    super("bot", "Opponent");
  }

  async makeMove(game) {
    await new Promise((resolve) => setTimeout(resolve, 800));

    if (game.phase === "main1" || game.phase === "main2") {
      this.mainPhaseLogic(game);
    } else if (game.phase === "battle") {
      this.battlePhaseLogic(game);
    } else if (game.phase === "end") {
      game.endTurn();
    }
  }

  mainPhaseLogic(game) {
    let bestCardIndex = -1;
    let maxAtk = -1;
    let summonInDefense = false;

    this.hand.forEach((card, index) => {
      if (card.cardKind !== "monster") return;
      let tributesNeeded = 0;
      if (card.level >= 5 && card.level <= 6) tributesNeeded = 1;
      else if (card.level >= 7) tributesNeeded = 2;

      if (this.field.length >= tributesNeeded) {
        if (card.atk > maxAtk) {
          maxAtk = card.atk;
          bestCardIndex = index;

          const opponentStrongest = game.player.field.reduce(
            (max, m) => Math.max(max, m.atk),
            0
          );
          summonInDefense =
            card.def > card.atk || opponentStrongest > card.atk + 500;
        }
      }
    });

    if (bestCardIndex !== -1) {
      const position = summonInDefense ? "defense" : "attack";
      const isFacedown = summonInDefense;
      const card = this.summon(bestCardIndex, position, isFacedown);
      if (card) {
        game.renderer.log(
          `Bot summons ${isFacedown ? "a monster in defense" : card.name}`
        );
        game.updateBoard();
      }
    }

    setTimeout(() => game.nextPhase(), 800);
  }

  battlePhaseLogic(game) {
    if (this.field.length > 0) {
      const attacker = this.field.find(
        (c) => c.position === "attack" && !c.hasAttacked
      );

      if (attacker) {
        const playerField = game.player.field;
        let target = null;

        if (playerField.length > 0) {
          const winnable = playerField.filter((m) => {
            if (m.position === "attack") {
              return attacker.atk > m.atk;
            } else {
              return attacker.atk > m.def;
            }
          });

          if (winnable.length > 0) {
            target = winnable.reduce((prev, curr) => {
              const prevStat = prev.position === "attack" ? prev.atk : prev.def;
              const currStat = curr.position === "attack" ? curr.atk : curr.def;
              return prevStat < currStat ? prev : curr;
            });
          } else {
            console.log("Bot skips attack (no safe target)");
            target = null;
          }
        }

        if (target || playerField.length === 0) {
          game.resolveCombat(attacker, target);
        }
      }
    }

    setTimeout(() => game.nextPhase(), 800);
  }
}
