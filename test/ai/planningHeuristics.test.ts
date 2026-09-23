import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeDefensiveTrap,
  analyzeSpellSpeed,
  calculateBlockingRiskPenalty,
  detectChainableOpponentCards,
  evaluateActionBlockingRisk,
  type ChainAwarenessState,
} from "../../src/core/ai/ChainAwareness.js";
import {
  calculateMacroPriorityBonus,
  decideMacroStrategy,
  detectLethalOpportunity,
  type MacroPlayerView,
} from "../../src/core/ai/MacroPlanning.js";
import {
  analyzeOpponent,
  estimateOppDamage,
  estimateTurnsToOppLethal,
  type OpponentPlayerView,
} from "../../src/core/ai/OpponentPredictor.js";
import {
  calculateActionImpact,
  calculateEffectUrgency,
  inferAllRoles,
  inferRole,
  isProactive,
  isReactive,
  type StrategicCardView,
} from "../../src/core/ai/RoleAnalyzer.js";
import {
  calculateThreatScore,
  canOpponentLethal,
  estimateTurnsToKill,
  getTopThreat,
} from "../../src/core/ai/ThreatEvaluation.js";
import type {
  ChainCard,
  ChainEffect,
  ChainPlayer,
} from "../../src/core/contracts/chainRuntime.js";

function vanillaMonster(
  name: string,
  atk: number,
  def: number,
  archetype = "Test",
): StrategicCardView {
  return {
    name,
    cardKind: "monster",
    atk,
    def,
    level: 4,
    position: "attack",
    archetype,
    archetypes: [archetype],
    effects: [],
  };
}

function chainPlayer(id: string): ChainPlayer {
  return {
    id,
    lp: 8000,
    deck: [],
    extraDeck: [],
    hand: [],
    field: [],
    spellTrap: [],
    graveyard: [],
    banished: [],
    fieldSpell: null,
  };
}

test("role analysis preserves role priority, discovery order and timing helpers", () => {
  const card: StrategicCardView = {
    name: "Multi-role Probe",
    cardKind: "monster",
    effects: [
      {
        timing: "on_play",
        actions: [
          { type: "special_summon_from_zone", zone: "graveyard" },
          { type: "destroy", targetRef: "opponentMonster" },
          {
            type: "buff_stats_temp",
            targetRef: "summonedMonster",
            atkBoost: 500,
          },
        ],
      },
      { timing: "passive", actions: [] },
    ],
  };

  assert.equal(inferRole(card), "removal");
  assert.deepEqual(inferAllRoles(card), [
    "extender",
    "removal",
    "combat_buff",
    "payoff",
  ]);
  assert.equal(calculateEffectUrgency(card.effects?.[1]), 1);
  assert.equal(
    calculateActionImpact({ type: "draw", amount: 3, player: "self" }),
    1.5,
  );
  assert.equal(isProactive(card), true);
  assert.equal(isReactive(card), false);
});

test("threat evaluation hides facedown DEF and counts every available attack", () => {
  const facedownDefender: StrategicCardView = {
    name: "Hidden Wall",
    cardKind: "monster",
    atk: 0,
    def: 9000,
    level: 0,
    position: "defense",
    isFacedown: true,
    effects: [],
  };
  const doubleAttacker: StrategicCardView = {
    ...vanillaMonster("Double Attacker", 2100, 1000),
    extraAttacks: 1,
  };

  assert.equal(
    calculateThreatScore(facedownDefender, { myStrongestAtk: 2000 }),
    0.8399999999999999,
  );
  assert.equal(
    getTopThreat([facedownDefender, doubleAttacker], {
      myStrongestAtk: 2000,
    })?.card,
    doubleAttacker,
  );
  assert.equal(estimateTurnsToKill(doubleAttacker, 4200), 1);
  assert.equal(canOpponentLethal([doubleAttacker], 4200), true);
});

test("macro planning keeps immediate lethal ahead of simultaneous defense", () => {
  const finisher: StrategicCardView = {
    ...vanillaMonster("Finisher", 2000, 1000),
    extraAttacks: 1,
  };
  const bot: MacroPlayerView = {
    lp: 3000,
    field: [finisher],
    hand: [],
    graveyard: [],
  };
  const opponent: MacroPlayerView = {
    lp: 4000,
    field: [vanillaMonster("Immediate Threat", 4000, 1000)],
  };
  const burnRemoval: StrategicCardView = {
    name: "Burning Removal",
    cardKind: "spell",
    description: "Destroy one opposing card.",
    effects: [
      {
        timing: "on_play",
        actions: [{ type: "damage", amount: 800, player: "opponent" }],
      },
    ],
  };

  assert.deepEqual(detectLethalOpportunity({}, bot, opponent, 2), {
    canLethal: true,
    turnsNeeded: 0,
    damage: 4000,
    confidence: 1,
  });
  const strategy = decideMacroStrategy({}, bot, opponent);
  assert.deepEqual(strategy, {
    strategy: "lethal",
    priority: 100,
    detail: "immediate_kill",
  });
  assert.equal(calculateMacroPriorityBonus("spell", burnRemoval, strategy), 20);
});

test("opponent prediction derives archetype, pressure and removal priority", () => {
  const firstAttacker = vanillaMonster("First Dragon", 2500, 1000, "Dragon");
  const secondAttacker = vanillaMonster("Second Dragon", 2500, 1000, "Dragon");
  const beater = vanillaMonster("Dragon Beater", 1800, 1000, "Dragon");
  const searcher: StrategicCardView = {
    name: "Dragon Searcher",
    cardKind: "spell",
    archetype: "Dragon",
    effects: [
      {
        timing: "on_play",
        actions: [{ type: "draw", amount: 1, player: "self" }],
      },
    ],
  };
  const removal: StrategicCardView = {
    name: "Dragon Removal",
    cardKind: "spell",
    archetype: "Dragon",
    effects: [
      {
        timing: "on_play",
        actions: [{ type: "destroy", targetRef: "opponentMonster" }],
      },
    ],
  };
  const opponent: OpponentPlayerView = {
    lp: 8000,
    field: [firstAttacker, secondAttacker],
    hand: [beater, searcher, removal],
    graveyard: [],
  };
  const me: OpponentPlayerView = {
    field: [vanillaMonster("My Threat", 2000, 1000)],
  };

  assert.deepEqual(analyzeOpponent(opponent, me), {
    archetype: "Dragon",
    playstyle: "aggressive",
    nextMove: { card: removal, role: "removal", confidence: 0.6 },
    threat_level: 2,
    field_power: 5000,
    field_size: 2,
  });
  assert.equal(estimateOppDamage(opponent), 5000);
  assert.equal(estimateTurnsToOppLethal(opponent), 2);
});

test("chain awareness finds nested negation through canonical simulation legality", () => {
  const effect: ChainEffect = {
    id: "nested-negation",
    speed: 2,
    actions: [
      {
        type: "conditional_actions",
        actions: [{ type: "negate_activation" }],
      },
    ],
  };
  const trap: ChainCard = {
    id: 501,
    name: "Nested Countermeasure",
    cardKind: "trap",
    subtype: "normal",
    effects: [effect],
  };
  const bot = chainPlayer("bot");
  const opponent = chainPlayer("opponent");
  opponent.spellTrap.push(trap);
  const state: ChainAwarenessState = { player: bot, bot: opponent };

  assert.deepEqual(analyzeSpellSpeed(effect, trap), {
    spellSpeed: 2,
    canChain: true,
    chainType: "spell_speed_2",
  });
  assert.deepEqual(analyzeDefensiveTrap(trap), {
    isDefensiveTrap: true,
    blocking: ["activation"],
    strength: "strong",
  });

  const blockingRisk = evaluateActionBlockingRisk(
    state,
    bot,
    opponent,
    "activation",
  );
  assert.deepEqual(blockingRisk, {
    riskLevel: "high",
    blockingCards: [
      {
        name: "Nested Countermeasure",
        strength: "strong",
        blocking: ["activation"],
      },
    ],
    negationChance: 0.7,
  });
  assert.equal(calculateBlockingRiskPenalty("activation", blockingRisk), -30);
  assert.deepEqual(detectChainableOpponentCards(state, opponent), {
    canChain: true,
    chainableCards: [
      {
        candidateKey: "501:nested-negation:spellTrap",
        effectId: "nested-negation",
        name: "Nested Countermeasure",
        type: "trap",
        chainType: "spell_speed_2",
        spellSpeed: 2,
        blocking: ["activation"],
      },
    ],
    chainDepth: 1,
  });
});
