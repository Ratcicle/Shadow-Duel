import { cardDatabaseById } from "../../data/cards.js";
import Card from "../Card.js";
import Player from "../Player.js";
import {
  DECK_TYPES,
  assertDeckBanlistLegal,
  getCardCopyLimit,
} from "../game/deck/banlist.js";
import { getBotDeckList, getBotExtraDeckList } from "./presets.js";
import type { RawCardDefinition } from "../contracts/cards.js";

type DeckBuilderBot = Player & { archetype?: string };

export function buildBotDeck(bot: DeckBuilderBot | null | undefined) {
  if (!bot) return;

  const deckList = getBotDeckList(bot.archetype);
  assertDeckBanlistLegal({ deck: deckList });
  bot.deck = [];
  const copies: Record<number, number> = {};

  const addCard = (data: RawCardDefinition) => {
    copies[data.id] = copies[data.id] || 0;
    const copyLimit = getCardCopyLimit(data.id, {
      deckType: DECK_TYPES.MAIN,
    });
    if (copies[data.id] >= copyLimit || bot.deck.length >= bot.maxDeckSize) {
      return false;
    }
    const card = new Card(data, bot.id);
    bot.game?.ensureDuelCardId?.(card);
    bot.deck.push(card);
    copies[data.id]++;
    return true;
  };

  for (const cardId of deckList) {
    const data: RawCardDefinition | undefined = cardDatabaseById.get(cardId);
    if (data) {
      addCard(data);
    }
  }

  bot.shuffleDeck();
}

export function buildBotExtraDeck(bot: DeckBuilderBot | null | undefined) {
  if (!bot) return;
  Player.prototype.buildExtraDeck.call(bot, getBotExtraDeckList(bot.archetype));
}
