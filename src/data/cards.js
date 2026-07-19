import { genericCards } from "./cards/generic.js";
import { shadowHeartCards } from "./cards/shadowHeart.js";
import { luminarchCards } from "./cards/luminarch.js";
import { voidCards } from "./cards/void.js";
import { dragonCards } from "./cards/dragon.js";
import { arcanistCards } from "./cards/arcanist.js";
import { mirageboundCards } from "./cards/miragebound.js";
import { bloomrotCards } from "./cards/bloomrot.js";
import { burningWestCards } from "./cards/burningWest.js";
import { techZeroCards } from "./cards/techZero.js";
import { vulcanomatonCards } from "./cards/vulcanomaton.js";

export const cardDatabaseGroups = [
  { rangeKey: "generic", cards: genericCards },
  { rangeKey: "shadowHeart", cards: shadowHeartCards },
  { rangeKey: "luminarch", cards: luminarchCards },
  { rangeKey: "void", cards: voidCards },
  { rangeKey: "dragon", cards: dragonCards },
  { rangeKey: "arcanist", cards: arcanistCards },
  { rangeKey: "miragebound", cards: mirageboundCards },
  { rangeKey: "bloomrot", cards: bloomrotCards },
  { rangeKey: "burningWest", cards: burningWestCards },
  { rangeKey: "techZero", cards: techZeroCards },
  { rangeKey: "vulcanomaton", cards: vulcanomatonCards },
];

export const cardDatabase = cardDatabaseGroups.flatMap((group) => group.cards);

// Performance optimization: Create indexed maps for O(1) lookups
export const cardDatabaseById = new Map(
  cardDatabase.map((card) => [card.id, card]),
);
export const cardDatabaseByName = new Map(
  cardDatabase.map((card) => [card.name, card]),
);
