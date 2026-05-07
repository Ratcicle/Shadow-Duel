import Game from "../src/core/Game.js";
import Card from "../src/core/Card.js";
import { cardDatabaseByName } from "../src/data/cards.js";

function makeCard(name, ownerId, overrides = {}) {
  const data = cardDatabaseByName.get(name);
  if (!data) {
    throw new Error(`Card not found: ${name}`);
  }
  return Object.assign(new Card(data, ownerId), overrides);
}

function makeScenario({
  hand = [],
  field = [],
  spellTrap = [],
  fieldSpell = null,
  graveyard = [],
  deck = [],
  extraDeck = [],
  opponentField = [],
  lp = 8000,
  opponentLp = 8000,
}) {
  const game = new Game({ botPreset: "luminarch", disableChains: true });
  const bot = game.bot;
  const opponent = game.player;

  game.turn = bot.id;
  game.phase = "main1";
  game.turnCounter = 3;
  game._suppressP2Analysis = true;

  bot.debug = false;
  bot.lp = lp;
  bot.summonCount = 0;
  bot.hand = hand.map((entry) => makeCard(entry, bot.id));
  bot.field = field.map((entry) => makeCard(entry.name || entry, bot.id, entry.overrides));
  bot.spellTrap = spellTrap.map((entry) => makeCard(entry.name || entry, bot.id, entry.overrides));
  bot.fieldSpell = fieldSpell ? makeCard(fieldSpell, bot.id) : null;
  bot.graveyard = graveyard.map((entry) => makeCard(entry.name || entry, bot.id, entry.overrides));
  bot.deck = deck.map((entry) => makeCard(entry, bot.id));
  bot.extraDeck = extraDeck.map((entry) => makeCard(entry, bot.id));

  opponent.lp = opponentLp;
  opponent.hand = [];
  opponent.field = opponentField.map((entry) =>
    makeCard(entry.name || entry, opponent.id, entry.overrides),
  );
  opponent.spellTrap = [];
  opponent.fieldSpell = null;
  opponent.graveyard = [];
  opponent.deck = [];
  opponent.extraDeck = [];

  return { game, bot, opponent };
}

function generateActions(setup) {
  const { game, bot } = makeScenario(setup);
  return bot.strategy.generateMainPhaseActions(game);
}

function runSimulation(setup, action) {
  const { game, bot, opponent } = makeScenario(setup);
  const state = {
    _isPerspectiveState: true,
    turnCounter: game.turnCounter,
    bot,
    player: opponent,
  };
  bot.strategy.simulateMainPhaseAction(state, action);
  return state;
}

function findAction(actions, predicate) {
  return actions.find(predicate) || null;
}

function findCardAction(actions, type, cardName) {
  return findAction(
    actions,
    (action) => action.type === type && action.cardName === cardName,
  );
}

function moonlitPositionFor(action, cardName) {
  return (
    action?.activationContext?.actionContext?.specialSummonPositions?.byName?.[
      cardName
    ] || null
  );
}

function moonlitTargetPreference(action) {
  return (
    action?.activationContext?.actionContext?.targetPreferences
      ?.moonlit_blessing_target || null
  );
}

const scenarios = [
  {
    name: "Radiant Lancer can spend Aegisbearer + Protector when it has a real 2500 kill line",
    setup: {
      hand: ["Luminarch Radiant Lancer"],
      field: ["Luminarch Aegisbearer", "Luminarch Sanctum Protector"],
      opponentField: ["Shadow-Heart Armored Arctroth", "Void Hollow King"],
    },
    expect(actions) {
      const action = findCardAction(
        actions,
        "summon",
        "Luminarch Radiant Lancer",
      );
      return {
        pass:
          !!action &&
          action.position === "attack" &&
          action.lancerPlan?.bestTargetStat === 2500 &&
          action.lancerPlan?.tradesNextThreat === true,
        details: action
          ? `position=${action.position}, targetStat=${action.lancerPlan?.bestTargetStat}, tradesNext=${action.lancerPlan?.tradesNextThreat}`
          : "Lancer summon was not generated",
      };
    },
  },
  {
    name: "Radiant Lancer does not spend the defensive core against only a 2800 threat",
    setup: {
      hand: ["Luminarch Radiant Lancer"],
      field: ["Luminarch Aegisbearer", "Luminarch Sanctum Protector"],
      opponentField: ["Shadow-Heart Armored Arctroth"],
    },
    expect(actions) {
      const action = findCardAction(
        actions,
        "summon",
        "Luminarch Radiant Lancer",
      );
      return {
        pass: !action,
        details: action
          ? `unexpected Lancer action: priority=${action.priority}, reason=${action.reason}`
          : "Lancer summon correctly absent",
      };
    },
  },
  {
    name: "Moonlit Blessing revives Celestial Marshal in attack when Citadel lets it clear the board",
    setup: {
      hand: ["Luminarch Moonlit Blessing"],
      fieldSpell: "Sanctum of the Luminarch Citadel",
      graveyard: ["Luminarch Celestial Marshal"],
      opponentField: ["Shadow-Heart Armored Arctroth"],
    },
    expect(actions) {
      const action = findCardAction(
        actions,
        "spell",
        "Luminarch Moonlit Blessing",
      );
      const position = moonlitPositionFor(action, "Luminarch Celestial Marshal");
      const targetPreference = moonlitTargetPreference(action);
      return {
        pass:
          !!action &&
          position === "attack" &&
          !!targetPreference &&
          targetPreference.preferredNames?.includes(
            "Luminarch Celestial Marshal",
          ),
        details: action
          ? `position=${position}, preferred=${targetPreference?.preferredNames?.join("|") || "none"}, reason=${action.reason}`
          : "Moonlit Blessing action was not generated",
      };
    },
  },
  {
    name: "Moonlit Blessing does not force Celestial Marshal to attack into an unmatched 3000 threat",
    setup: {
      hand: ["Luminarch Moonlit Blessing"],
      fieldSpell: "Sanctum of the Luminarch Citadel",
      graveyard: ["Luminarch Celestial Marshal"],
      opponentField: ["Shadow-Heart Scale Dragon"],
    },
    expect(actions) {
      const action = findCardAction(
        actions,
        "spell",
        "Luminarch Moonlit Blessing",
      );
      const position = moonlitPositionFor(action, "Luminarch Celestial Marshal");
      return {
        pass: !!action && position !== "attack",
        details: action
          ? `position=${position}, reason=${action.reason}`
          : "Moonlit Blessing action was not generated",
      };
    },
  },
  {
    name: "Moonblade Captain does not tribute Aurora Seraph as the only body without urgent payoff",
    setup: {
      hand: ["Luminarch Moonblade Captain"],
      field: ["Luminarch Aurora Seraph"],
      graveyard: ["Luminarch Aegisbearer"],
      opponentField: [],
    },
    expect(actions) {
      const action = findCardAction(
        actions,
        "summon",
        "Luminarch Moonblade Captain",
      );
      return {
        pass: !action,
        details: action
          ? `unexpected Moonblade action: priority=${action.priority}, reason=${action.reason}`
          : "Moonblade summon correctly absent",
      };
    },
  },
  {
    name: "Moonblade Captain remains available with an expendable Halberd tribute and a Lv4 GY target",
    setup: {
      hand: ["Luminarch Moonblade Captain"],
      field: ["Luminarch Enchanted Halberd"],
      graveyard: ["Luminarch Aegisbearer"],
      opponentField: ["Void Hollow King"],
    },
    expect(actions) {
      const action = findCardAction(
        actions,
        "summon",
        "Luminarch Moonblade Captain",
      );
      return {
        pass: !!action,
        details: action
          ? `position=${action.position}, priority=${action.priority}, reason=${action.reason}`
        : "Moonblade summon was not generated",
      };
    },
  },
  {
    name: "Sanctum Protector special summon remains available from Aegisbearer",
    setup: {
      hand: ["Luminarch Sanctum Protector"],
      field: [
        {
          name: "Luminarch Aegisbearer",
          overrides: { isFacedown: false, position: "defense" },
        },
      ],
      opponentField: ["Void Hollow King"],
    },
    expect(actions) {
      const action = findCardAction(
        actions,
        "special_summon_sanctum_protector",
        "Luminarch Sanctum Protector",
      );
      return {
        pass:
          !!action && action.position === "defense" && action.materialIndex === 0,
        details: action
          ? `position=${action.position}, materialIndex=${action.materialIndex}, priority=${action.priority}`
          : "Sanctum Protector special summon was not generated",
      };
    },
  },
  {
    name: "Polymerization keeps Megashield Barbarias fusion action in defense",
    setup: {
      hand: [
        "Polymerization",
        "Luminarch Sanctum Protector",
        "Luminarch Radiant Lancer",
      ],
      extraDeck: ["Luminarch Megashield Barbarias"],
      opponentField: ["Void Hollow King"],
    },
    expect(actions) {
      const action = findAction(
        actions,
        (entry) =>
          entry.type === "spell" &&
          entry.cardName === "Polymerization" &&
          entry.fusionTarget === "Luminarch Megashield Barbarias",
      );
      const fusionPosition =
        action?.activationContext?.actionContext?.fusionPositions?.byName?.[
          "Luminarch Megashield Barbarias"
        ] || null;
      return {
        pass: !!action && fusionPosition === "defense",
        details: action
          ? `priority=${action.priority}, fusionTarget=${action.fusionTarget}, position=${fusionPosition}`
          : "Megashield fusion action was not generated",
      };
    },
  },
  {
    name: "Fortress Aegis ascension remains available from aged Aegisbearer",
    setup: {
      field: [
        {
          name: "Luminarch Aegisbearer",
          overrides: {
            isFacedown: false,
            position: "defense",
            summonedTurn: 1,
            fieldAgeTurns: 2,
          },
        },
      ],
      graveyard: [
        "Luminarch Valiant - Knight of the Dawn",
        "Luminarch Enchanted Halberd",
      ],
      extraDeck: ["Luminarch Fortress Aegis"],
      opponentField: ["Void Hollow King"],
    },
    expect(actions) {
      const action = findCardAction(
        actions,
        "ascension",
        "Luminarch Fortress Aegis",
      );
      return {
        pass:
          !!action &&
          action.position === "defense" &&
          action.materialIndex === 0 &&
          action.materialName === "Luminarch Aegisbearer",
        details: action
          ? `position=${action.position}, material=${action.materialName}, priority=${action.priority}`
          : "Fortress Aegis ascension action was not generated",
      };
    },
  },
];

const simulationScenarios = [
  {
    name: "Simulation: Valiant searches Aegisbearer from deck",
    setup: {
      hand: ["Luminarch Valiant - Knight of the Dawn"],
      deck: ["Luminarch Aegisbearer", "Luminarch Magic Sickle"],
    },
    action: {
      type: "summon",
      index: 0,
      cardName: "Luminarch Valiant - Knight of the Dawn",
      position: "attack",
      facedown: false,
    },
    expect(state) {
      const fieldCard = state.bot.field[0];
      return {
        pass:
          state.bot.hand.some((card) => card.name === "Luminarch Aegisbearer") &&
          !state.bot.deck.some((card) => card.name === "Luminarch Aegisbearer") &&
          fieldCard?._searchedAegis === true,
        details: `hand=${state.bot.hand.map((card) => card.name).join("|")}, deck=${state.bot.deck.map((card) => card.name).join("|")}`,
      };
    },
  },
  {
    name: "Simulation: Arbiter searches Citadel from deck",
    setup: {
      hand: ["Luminarch Sanctified Arbiter"],
      deck: ["Sanctum of the Luminarch Citadel", "Luminarch Holy Shield"],
    },
    action: {
      type: "summon",
      index: 0,
      cardName: "Luminarch Sanctified Arbiter",
      position: "attack",
      facedown: false,
    },
    expect(state) {
      const fieldCard = state.bot.field[0];
      return {
        pass:
          state.bot.hand.some(
            (card) => card.name === "Sanctum of the Luminarch Citadel",
          ) &&
          !state.bot.deck.some(
            (card) => card.name === "Sanctum of the Luminarch Citadel",
          ) &&
          fieldCard?._searchedSpell === true,
        details: `hand=${state.bot.hand.map((card) => card.name).join("|")}, deck=${state.bot.deck.map((card) => card.name).join("|")}`,
      };
    },
  },
  {
    name: "Simulation: Protector shortcut sends Aegisbearer to GY",
    setup: {
      hand: ["Luminarch Sanctum Protector"],
      field: [
        {
          name: "Luminarch Aegisbearer",
          overrides: { isFacedown: false, position: "defense" },
        },
      ],
    },
    action: {
      type: "special_summon_sanctum_protector",
      index: 0,
      cardName: "Luminarch Sanctum Protector",
      materialIndex: 0,
      position: "defense",
    },
    expect(state) {
      const protector = state.bot.field[0];
      return {
        pass:
          protector?.name === "Luminarch Sanctum Protector" &&
          protector.position === "defense" &&
          state.bot.graveyard.some(
            (card) => card.name === "Luminarch Aegisbearer",
          ),
        details: `field=${state.bot.field.map((card) => card.name).join("|")}, gy=${state.bot.graveyard.map((card) => card.name).join("|")}`,
      };
    },
  },
  {
    name: "Simulation: Barbarias stance dance keeps +800 ATK mutation",
    setup: {
      field: [
        {
          name: "Luminarch Megashield Barbarias",
          overrides: { position: "defense", isFacedown: false, atk: 2500 },
        },
      ],
    },
    action: {
      type: "monsterEffect",
      fieldIndex: 0,
      cardName: "Luminarch Megashield Barbarias",
    },
    expect(state) {
      const barbarias = state.bot.field[0];
      return {
        pass:
          barbarias?.position === "attack" &&
          barbarias.atk === 3300 &&
          barbarias.tempAtkBoost === 800,
        details: `position=${barbarias?.position}, atk=${barbarias?.atk}, tempAtk=${barbarias?.tempAtkBoost || 0}`,
      };
    },
  },
  {
    name: "Simulation: Citadel field effect applies +500 target preference",
    setup: {
      fieldSpell: "Sanctum of the Luminarch Citadel",
      field: [
        {
          name: "Luminarch Radiant Lancer",
          overrides: { position: "attack", isFacedown: false },
        },
      ],
    },
    action: {
      type: "fieldEffect",
      cardName: "Sanctum of the Luminarch Citadel",
    },
    expect(state) {
      const lancer = state.bot.field[0];
      return {
        pass: lancer?.tempAtkBoost === 500,
        details: `target=${lancer?.name}, tempAtk=${lancer?.tempAtkBoost || 0}`,
      };
    },
  },
  {
    name: "Simulation: Fortress Aegis ascension moves material and Extra Deck",
    setup: {
      field: [
        {
          name: "Luminarch Aegisbearer",
          overrides: { isFacedown: false, position: "defense" },
        },
      ],
      extraDeck: ["Luminarch Fortress Aegis"],
    },
    action: {
      type: "ascension",
      materialIndex: 0,
      cardName: "Luminarch Fortress Aegis",
      ascensionCard: makeCard("Luminarch Fortress Aegis", "bot"),
      position: "defense",
    },
    expect(state) {
      const fortress = state.bot.field[0];
      return {
        pass:
          fortress?.name === "Luminarch Fortress Aegis" &&
          fortress.position === "defense" &&
          state.bot.extraDeck.length === 0 &&
          state.bot.graveyard.some(
            (card) => card.name === "Luminarch Aegisbearer",
          ),
        details: `field=${fortress?.name}, extra=${state.bot.extraDeck.length}, gy=${state.bot.graveyard.map((card) => card.name).join("|")}`,
      };
    },
  },
];

let failures = 0;

for (const scenario of scenarios) {
  let result;
  try {
    const actions = generateActions(scenario.setup);
    result = scenario.expect(actions);
  } catch (error) {
    result = { pass: false, details: error.stack || error.message };
  }

  if (!result.pass) {
    failures += 1;
  }

  const marker = result.pass ? "PASS" : "FAIL";
  console.log(`[${marker}] ${scenario.name}`);
  console.log(`       ${result.details}`);
}

for (const scenario of simulationScenarios) {
  let result;
  try {
    const state = runSimulation(scenario.setup, scenario.action);
    result = scenario.expect(state);
  } catch (error) {
    result = { pass: false, details: error.stack || error.message };
  }

  if (!result.pass) {
    failures += 1;
  }

  const marker = result.pass ? "PASS" : "FAIL";
  console.log(`[${marker}] ${scenario.name}`);
  console.log(`       ${result.details}`);
}

if (failures > 0) {
  console.error(`\n${failures} Luminarch baseline scenario(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nAll Luminarch baseline scenarios passed.");
}
