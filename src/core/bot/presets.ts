import type { BotArchetypeId } from "../contracts/bot.js";

export interface BotPresetPresentation {
  id: BotArchetypeId | "techzero";
  label: string;
  hudAccent: string;
  avatarPortrait: {
    asset: string;
    sourceWidth: number;
    /** Square in original image pixels; scaled uniformly at every HUD size. */
    crop: { x: number; y: number; size: number };
  };
}

const BOT_PRESET_PRESENTATIONS: readonly BotPresetPresentation[] = [
  { id: "shadowheart", label: "Shadow-Heart", hudAccent: "#de648b",
    avatarPortrait: { asset: "assets/Shadow-Heart Scale Dragon.png", sourceWidth: 896, crop: { x: 190, y: 105, size: 470 } } },
  { id: "luminarch", label: "Luminarch", hudAccent: "#dfbd69",
    avatarPortrait: { asset: "assets/Luminarch Fortress Aegis.png", sourceWidth: 896, crop: { x: 300, y: 115, size: 420 } } },
  { id: "void", label: "Void", hudAccent: "#9975e2",
    avatarPortrait: { asset: "assets/Arcturus, Lord of the Void.png", sourceWidth: 896, crop: { x: 210, y: 30, size: 520 } } },
  { id: "dragon", label: "Dragon", hudAccent: "#7ca9ed",
    avatarPortrait: { asset: "assets/Radiant Cosmic Dragon.png", sourceWidth: 896, crop: { x: 220, y: 90, size: 560 } } },
  { id: "arcanist", label: "Arcanist", hudAccent: "#58c9e0",
    avatarPortrait: { asset: "assets/Arcanist Apprentice.png", sourceWidth: 896, crop: { x: 155, y: 100, size: 470 } } },
  { id: "miragebound", label: "Miragebound", hudAccent: "#64bfae",
    avatarPortrait: { asset: "assets/Miragebound Rebel.png", sourceWidth: 896, crop: { x: 235, y: 45, size: 470 } } },
  { id: "bloomrot", label: "Bloomrot", hudAccent: "#a7bc62",
    avatarPortrait: { asset: "assets/Bloomrot Carrioncap.png", sourceWidth: 896, crop: { x: 240, y: 230, size: 590 } } },
  { id: "burningwest", label: "Burning West", hudAccent: "#e8874f",
    avatarPortrait: { asset: "assets/Gunslinger of the Burning West.png", sourceWidth: 896, crop: { x: 220, y: 65, size: 440 } } },
  // Presentation is ready; Tech-Zero is not a playable AI preset yet.
  { id: "techzero", label: "Tech-Zero", hudAccent: "#eb645b",
    avatarPortrait: { asset: "assets/Tech Zero Explosive Lancer.png", sourceWidth: 896, crop: { x: 240, y: 230, size: 530 } } },
];

const AVAILABLE_BOT_PRESET_IDS: readonly BotArchetypeId[] = [
  "shadowheart", "luminarch", "void", "dragon", "arcanist", "miragebound", "bloomrot", "burningwest",
];

const MAIN_DECKS: Record<string, number[]> = {
  shadowheart: [
    116, 104, 111, 111, 117, 114, 101, 101, 107, 107, 118, 118, 125, 109, 108,
    102, 115, 12, 12, 105, 119, 106, 106, 17, 110, 110, 103, 112, 113, 120,
  ],
  luminarch: [
    159, 158, 155, 157, 154, 154, 153, 153, 153, 168, 160, 160, 151, 151, 151,
    156, 165, 163, 152, 161, 169, 169, 164, 170, 167, 166, 12, 12, 162, 162,
  ],
  void: [
    224, 212, 221, 208, 214, 209, 205, 203, 201, 201, 201, 211, 211, 202, 202,
    206, 204, 204, 204, 210, 12, 12, 12, 216, 217, 218, 219, 219, 220,
  ],
  dragon: [
    255, 252, 252, 252, 254, 256, 280, 280, 280, 279, 279, 279, 278, 278,
    251, 260, 257, 259, 264, 270, 271, 12, 12, 261, 261, 277, 262, 268, 18,
  ],
  arcanist: [
    302, 302, 302, 307, 307, 307, 314, 314, 306, 306, 305, 305, 308, 313, 312,
    312, 312, 301, 301, 301, 316, 316, 316, 311, 311, 304, 304, 310, 303, 309,
  ],
  miragebound: [
    358, 358, 364, 353, 353, 352, 352, 352, 351, 351, 351, 357, 356, 356,
    362, 362, 361, 361, 359, 359, 354, 354, 354, 360, 360,
  ],
  bloomrot: [
    406, 406, 401, 403, 403, 402, 402, 405, 405, 405, 404, 404, 407, 408,
    411, 414, 414, 409, 409, 413, 415, 412, 412, 410, 410, 410, 416, 417,
    417, 12,
  ],
  burningwest: [
    454, 454, 454, 451, 451, 451, 455, 455, 460, 460, 453, 461, 452, 452,
    452, 456, 456, 457, 457, 458, 459, 462, 463, 463, 464, 465,
  ],
};

const EXTRA_DECKS: Record<string, number[]> = {
  shadowheart: [121, 123, 122, 124],
  luminarch: [171, 172, 173, 174],
  void: [207, 213, 215, 226, 227, 222, 223, 225],
  dragon: [265, 266, 267, 253],
  arcanist: [],
  miragebound: [355, 363],
  bloomrot: [418, 419, 420],
  burningwest: [466],
};

function copyDeckList(deckList: readonly number[] = []) {
  return [...deckList];
}

export function getAvailableBotPresets() {
  return AVAILABLE_BOT_PRESET_IDS.map((id) => {
    const presentation = getBotPresetPresentation(id);
    if (!presentation) throw new Error(`Missing presentation for bot preset: ${id}`);
    return { ...presentation, id };
  });
}

export function getBotPresetPresentation(id: string | undefined): BotPresetPresentation | null {
  const preset = BOT_PRESET_PRESENTATIONS.find((preset) => preset.id === id);
  return preset ? structuredClone(preset) : null;
}

export function getBotDeckList(archetype = "shadowheart") {
  return copyDeckList(MAIN_DECKS[archetype] || MAIN_DECKS.luminarch);
}

export function getBotExtraDeckList(archetype = "shadowheart") {
  return copyDeckList(EXTRA_DECKS[archetype] || EXTRA_DECKS.luminarch);
}
