import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { required, unsafeFixture } from "./helpers/fixtures.js";
import { createMemoryStorage } from "./helpers/game.js";

import Bot from "../src/core/Bot.js";
import { validateCardDatabase } from "../src/core/CardDatabaseValidator.js";
import Player from "../src/core/Player.js";
import {
  DECK_TYPES,
  getBanlistStatus,
  getCardCopyLimit,
  getDeckCopyLimitState,
  validateBanlistDefinition,
  validateDeckAgainstBanlist,
} from "../src/core/game/deck/banlist.js";
import { BANLIST_STATUS, CURRENT_BANLIST } from "../src/data/banlist.js";
import { createDeckBuilderController } from "../src/ui/main/deckBuilderController.js";
import {
  buildDefaultDeck,
  sanitizeDeck,
  topUpDeck,
} from "../src/ui/main/deckState.js";
import { cardDatabase, cardDatabaseById } from "./helpers/fixtures.js";

const MONSTER_REBORN_ID = 8;

test("Monster Reborn is the initial limited card", () => {
  assert.deepEqual(CURRENT_BANLIST, {
    [MONSTER_REBORN_ID]: BANLIST_STATUS.LIMITED,
  });
  assert.equal(getBanlistStatus(MONSTER_REBORN_ID), BANLIST_STATUS.LIMITED);
  assert.equal(getBanlistStatus(1), BANLIST_STATUS.UNLIMITED);
  assert.equal(
    getCardCopyLimit(MONSTER_REBORN_ID, { deckType: DECK_TYPES.MAIN }),
    1,
  );
});

test("copy limits cover forbidden, limited, semi-limited and unlimited cards", () => {
  const banlist = {
    1: BANLIST_STATUS.FORBIDDEN,
    2: BANLIST_STATUS.LIMITED,
    3: BANLIST_STATUS.SEMI_LIMITED,
    4: BANLIST_STATUS.UNLIMITED,
    29: BANLIST_STATUS.SEMI_LIMITED,
  };

  assert.equal(getCardCopyLimit(1, { deckType: DECK_TYPES.MAIN, banlist }), 0);
  assert.equal(getCardCopyLimit(2, { deckType: DECK_TYPES.MAIN, banlist }), 1);
  assert.equal(getCardCopyLimit(3, { deckType: DECK_TYPES.MAIN, banlist }), 2);
  assert.equal(getCardCopyLimit(4, { deckType: DECK_TYPES.MAIN, banlist }), 3);
  assert.equal(
    getCardCopyLimit(29, { deckType: DECK_TYPES.EXTRA, banlist }),
    1,
  );

  assert.deepEqual(
    getDeckCopyLimitState(1, 0, {
      deckType: DECK_TYPES.MAIN,
      banlist,
    }),
    {
      cardId: 1,
      status: BANLIST_STATUS.FORBIDDEN,
      count: 0,
      limit: 0,
      restricted: true,
      atLimit: true,
      label: "0/0",
    },
  );
  assert.equal(
    getDeckCopyLimitState(2, 0, {
      deckType: DECK_TYPES.MAIN,
      banlist,
    }).label,
    "0/1",
  );
  assert.equal(
    getDeckCopyLimitState(3, 0, {
      deckType: DECK_TYPES.MAIN,
      banlist,
    }).label,
    "0/2",
  );
});

test("deck validation returns serializable violations with exact counts", () => {
  const banlist = {
    1: BANLIST_STATUS.FORBIDDEN,
    2: BANLIST_STATUS.LIMITED,
    3: BANLIST_STATUS.SEMI_LIMITED,
  };
  const result = validateDeckAgainstBanlist(
    {
      deck: [1, 2, 2, 3, 3, 3],
      extraDeck: [29, 29],
    },
    { banlist },
  );

  assert.ok(result.ok === false);
  assert.deepEqual(result.violations, [
    {
      cardId: 29,
      status: BANLIST_STATUS.UNLIMITED,
      count: 2,
      limit: 1,
      deckType: DECK_TYPES.EXTRA,
    },
    {
      cardId: 1,
      status: BANLIST_STATUS.FORBIDDEN,
      count: 1,
      limit: 0,
      deckType: DECK_TYPES.MAIN,
    },
    {
      cardId: 2,
      status: BANLIST_STATUS.LIMITED,
      count: 2,
      limit: 1,
      deckType: DECK_TYPES.MAIN,
    },
    {
      cardId: 3,
      status: BANLIST_STATUS.SEMI_LIMITED,
      count: 3,
      limit: 2,
      deckType: DECK_TYPES.MAIN,
    },
  ]);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("banlist definition validation rejects unknown ids and statuses", () => {
  assert.ok(validateBanlistDefinition(cardDatabase).ok === true);

  const result = validateBanlistDefinition(cardDatabase, {
    999999: BANLIST_STATUS.LIMITED,
    8: "invalid",
  });
  assert.ok(result.ok === false);
  assert.equal(result.errors.length, 2);
  const messages = result.errors.map((error) => error.message).join("\n");
  assert.match(messages, /unknown card id/i);
  assert.match(messages, /status .* invalid/i);
});

test("saved decks preserve old excess copies while generated decks obey the banlist", () => {
  assert.deepEqual(
    sanitizeDeck([MONSTER_REBORN_ID, MONSTER_REBORN_ID, MONSTER_REBORN_ID]),
    [MONSTER_REBORN_ID, MONSTER_REBORN_ID, MONSTER_REBORN_ID],
  );

  const toppedUp = topUpDeck([]);
  assert.ok(toppedUp.length >= 20);
  assert.equal(toppedUp.filter((id) => id === MONSTER_REBORN_ID).length, 1);
});

test("runtime deck construction rejects violations instead of truncating them", () => {
  const player = new Player("player", "Player");
  assert.throws(
    () =>
      player.buildDeck([
        MONSTER_REBORN_ID,
        MONSTER_REBORN_ID,
        ...buildDefaultDeck().filter((id) => id !== MONSTER_REBORN_ID),
      ]),
    /Deck violates copy limits.*8: 2\/1/i,
  );

  player.buildDeck(buildDefaultDeck());
  assert.equal(
    player.deck.filter((card) => card.id === MONSTER_REBORN_ID).length,
    1,
  );
});

test("all bot presets comply with the central copy limits", () => {
  for (const preset of Bot.getAvailablePresets()) {
    const bot = new Bot(preset.id);
    assert.doesNotThrow(() => bot.buildDeck(), preset.id);
    assert.doesNotThrow(() => bot.buildExtraDeck(), preset.id);
    const deckIds = bot.deck.map((card) => required(card.id));
    const extraDeckIds = bot.extraDeck.map((card) => required(card.id));
    assert.equal(
      validateDeckAgainstBanlist({
        deck: deckIds,
        extraDeck: extraDeckIds,
      }).ok,
      true,
      preset.id,
    );
  }
});

test("deck builder blocks an old invalid deck without mutating it", () => {
  const validDeck = buildDefaultDeck();
  const invalidDeck = [
    MONSTER_REBORN_ID,
    MONSTER_REBORN_ID,
    ...validDeck.filter((id) => id !== MONSTER_REBORN_ID).slice(0, 18),
  ];
  const originalDeck = [...invalidDeck];
  let allowSave = false;
  let alertMessage = "";
  const previousAlert = globalThis.alert;
  const previousLocalStorage = globalThis.localStorage;
  globalThis.alert = (message) => {
    alertMessage = String(message);
  };
  globalThis.localStorage = createMemoryStorage();

  try {
    const controller = createDeckBuilderController({
      dom: unsafeFixture<
        Parameters<typeof createDeckBuilderController>[0]["dom"]
      >({}, "The deck validation test does not render or bind DOM elements."),
      deckState: unsafeFixture<
        Parameters<typeof createDeckBuilderController>[0]["deckState"]
      >(
        {
          getCurrentDeck: () => invalidDeck,
          getCurrentExtraDeck: () => [],
          saveDeck: () => {
            if (!allowSave)
              assert.fail("invalid deck must not be saved for play");
          },
          saveExtraDeck: () => {
            if (!allowSave) {
              assert.fail("invalid Extra Deck must not be saved for play");
            }
          },
        },
        "The validation fixture provides only the deck read/save operations under test.",
      ),
      Bot: class FixtureBot extends Bot {
        static override getAvailablePresets() {
          return [{ id: "shadowheart" as const, label: "Shadow-Heart" }];
        }
      },
      getCardDisplayDescription: (card) => card?.description || "",
      getCardDisplayName: (card) => card?.name || "",
    });

    assert.equal(controller.prepareForDuel(), null);
    assert.match(alertMessage, /Monster Reborn.*2\/1/i);
    assert.deepEqual(invalidDeck, originalDeck);

    invalidDeck.splice(1, 1);
    invalidDeck.push(
      required(validDeck.filter((id) => id !== MONSTER_REBORN_ID).at(-1)),
    );
    allowSave = true;
    assert.ok(controller.prepareForDuel());
  } finally {
    globalThis.alert = previousAlert;
    globalThis.localStorage = previousLocalStorage;
  }
});

test("Monster Reborn locale and restricted badge styles are updated", () => {
  const locale = JSON.parse(
    readFileSync(
      new URL("../public/locales/pt-br.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    locale.cards[String(MONSTER_REBORN_ID)].description,
    "Escolha 1 monstro em qualquer Cemitério; Invoque-o por Invocação-Especial no seu campo.",
  );
  assert.equal(
    required(cardDatabaseById.get(MONSTER_REBORN_ID)).description,
    "Target 1 monster in any Graveyard; Special Summon it to your field.",
  );

  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.pool-count\.banlist-restricted\s*\{[^}]*#ff3b4f/s);
  assert.match(
    css,
    /\.deck-list-copy-badge\.banlist-restricted\s*\{[^}]*#ff3b4f/s,
  );

  const validation = validateCardDatabase();
  assert.deepEqual(validation.errors, []);
});
