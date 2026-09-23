import type { AIAction, AIPlannedAction, ExtraDeckMaterialHint } from "../contracts/ai.js";
import type { AiStateInput } from "../contracts/aiState.js";
import type { BotGamePort, BotRuntimePort } from "../contracts/bot.js";
import type { GameCard } from "../contracts/cards.js";
import type { GameRuntimeState } from "../contracts/gameRuntime.js";
import { fingerprintPlanningState, PLANNING_ZONES } from "../ai/common/stateFingerprint.js";
import { resolveHandIndexForAction, resolveHandProcedureMaterials } from "./actionValidation.js";

type CanonicalValue = null | boolean | number | string | CanonicalValue[];
type MainPhaseIdentityGame = Pick<BotGamePort,
  | "player" | "bot" | "turn" | "phase" | "turnCounter" | "gameOver" | "winner"
  | "oncePerTurnUsage" | "oncePerTurnTurnCounter" | "effectUsageReservations"
  | "materialDuelStats" | "specialSummonTypeCounts"
> & {
  effectEngine: Pick<BotGamePort["effectEngine"], "usedThisTurn" | "clearTargetingCache">;
};

function instanceIdentity(card: object, fallback: string): string {
  for (const field of ["duelCardId", "instanceId", "_instanceId", "uid", "uuid", "simInstanceId"] as const) {
    const value: unknown = Reflect.get(card, field);
    if (typeof value === "string" || typeof value === "number") return JSON.stringify([field, value]);
  }
  // Runtime cards have instance identity. Legacy fixtures without it can only
  // identify a copy by its zone/graph path, not track that copy across moves.
  return JSON.stringify(["legacy-path", fallback]);
}

function runtimeReferences(game: MainPhaseIdentityGame, bot: BotRuntimePort) {
  const references = new Map<object, string>([[game, "game"], [game.player, `player:${game.player.id}`], [game.bot, `player:${game.bot.id}`]]);
  const cards: GameCard[] = [];
  function register(card: GameCard | null | undefined, path: string): void {
    if (!card || references.has(card)) return;
    references.set(card, instanceIdentity(card, path));
    cards.push(card);
  }
  for (const player of [bot, game.player, game.bot]) {
    references.set(player, `player:${player.id}`);
    for (const zone of PLANNING_ZONES) player[zone]?.forEach((card, index) => register(card, `${player.id}/${zone}/${index}`));
    register(player.fieldSpell, `${player.id}/fieldSpell`);
  }
  // Equipment can retain a card reference after it leaves the ordinary zones.
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index];
    if (!card) continue;
    const identity = references.get(card);
    register(card.equippedTo, `${identity}/equippedTo`);
    if (typeof card.equipTarget === "object") register(card.equipTarget, `${identity}/equipTarget`);
    register(card.boundTrapSource, `${identity}/boundTrapSource`);
    register(card.boundMonsterTarget, `${identity}/boundMonsterTarget`);
    card.equips?.forEach((equip, equipIndex) => register(equip, `${identity}/equips/${equipIndex}`));
  }
  return { references, cards };
}

/** Canonicalize projected data only; callbacks and live object references are never executed. */
function canonicalize(value: unknown, references: ReadonlyMap<object, string>, ancestors = new Set<object>()): CanonicalValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0) ? value : ["number", String(value), Object.is(value, -0)];
  if (value === undefined || typeof value === "function") return ["undefined"];
  if (typeof value !== "object") throw new TypeError("Unsupported main-phase identity metadata");
  const reference = references.get(value);
  if (reference !== undefined) return ["reference", reference];
  if (ancestors.has(value)) throw new TypeError("Cyclic main-phase identity metadata");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return ["array", Array.from({ length: value.length }, (_, i) => i in value ? canonicalize(value[i], references, ancestors) : ["hole"])];
    if (value instanceof Map) {
      const entries = [...value].map(([key, entry]) => [canonicalize(key, references, ancestors), canonicalize(entry, references, ancestors)]);
      entries.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
      return ["map", entries];
    }
    if (value instanceof Set) {
      const entries = [...value].map(entry => canonicalize(entry, references, ancestors));
      entries.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
      return ["set", entries];
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError("Unsupported main-phase identity object");
    }
    const entries: CanonicalValue[] = [];
    for (const key of Object.keys(value).sort()) {
      // Temporary event registrations retain source artwork for display only.
      if (key === "_gameRef" || key === "sourceImage") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) throw new TypeError("Accessor in main-phase identity metadata");
      const entry: unknown = descriptor.value;
      if (typeof entry === "function" || entry === undefined) continue;
      entries.push([key, canonicalize(entry, references, ancestors)]);
    }
    return ["object", entries];
  } finally {
    ancestors.delete(value);
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function temporaryRuntimeData(game: MainPhaseIdentityGame): object {
  const fields = ["temporaryReplacementEffects", "temporaryEventEffects", "temporaryControlEffects", "temporaryBattlePairEffects", "delayedActions"] as const satisfies readonly (keyof GameRuntimeState)[];
  return Object.fromEntries(fields.map(field => {
    const value: unknown = Reflect.get(game, field);
    if (value !== undefined && !Array.isArray(value)) throw new TypeError(`Invalid runtime ${field}`);
    return [field, value];
  }));
}

/** Read-only runtime adapter; the shared planner fingerprint keeps its original contract. */
export function fingerprintMainPhaseState(game: MainPhaseIdentityGame, bot: BotRuntimePort): string {
  const projection = {
    bot,
    player: game.player.id === bot.id ? game.bot : game.player,
    turn: game.turn,
    phase: game.phase,
    turnCounter: game.turnCounter,
    gameOver: game.gameOver,
    winner: game.winner,
    usedThisTurn: game.effectEngine?.usedThisTurn,
  } satisfies AiStateInput & {
    gameOver: boolean;
    winner: BotGamePort["winner"];
    usedThisTurn: BotGamePort["effectEngine"]["usedThisTurn"];
  };
  const { references, cards } = runtimeReferences(game, bot);
  const usage = game.oncePerTurnUsage;
  const runtimeData = {
    actor: bot.id,
    oncePerTurnTurnCounter: game.oncePerTurnTurnCounter,
    playerUsage: usage?.player,
    botUsage: usage?.bot,
    cardUsage: cards.map(card => [references.get(card), usage?.card.get(card)]).sort((a, b) => compare(String(a[0]), String(b[0]))),
    effectUsageReservations: game.effectUsageReservations,
    materialDuelStats: game.materialDuelStats,
    specialSummonTypeCounts: game.specialSummonTypeCounts,
    temporaryEffects: temporaryRuntimeData(game),
  };
  return JSON.stringify([fingerprintPlanningState(projection), canonicalize(runtimeData, references)]);
}

function indexedCard(cards: readonly GameCard[], index: number | undefined): GameCard | undefined {
  return index !== undefined && Number.isInteger(index) ? cards[index] : undefined;
}

function fieldOrGraveSource(cards: readonly GameCard[], index: number | undefined, action: AIAction): GameCard | undefined {
  if (index !== undefined && Number.isInteger(index)) return cards[index];
  return cards.find(card => card.id === action.cardId || (!action.cardId && card.name === action.cardName));
}

function extraDeckSource(bot: BotRuntimePort, action: Extract<AIAction, { type: "extraDeckProcedure" }>): GameCard | undefined {
  const matches = (card: GameCard) => card.id === action.cardId || card.name === action.cardName || card.name === action.extraDeckCard?.name;
  const direct = indexedCard(bot.extraDeck, action.extraDeckIndex);
  return direct && matches(direct) ? direct : bot.extraDeck.find(matches);
}

function extraDeckMaterial(bot: BotRuntimePort, hint: ExtraDeckMaterialHint): GameCard | undefined {
  if (hint.instanceIds?.length) {
    const found = bot.field.find(card => [card.instanceId, card._instanceId, Reflect.get(card, "uid"), card.uuid, Reflect.get(card, "simInstanceId"), card.fieldPresenceId]
      .some((id: unknown) => (typeof id === "string" || typeof id === "number") && hint.instanceIds?.includes(id)));
    if (found) return found;
  }
  const matches = (card: GameCard) => (hint.id === undefined || card.id === hint.id) && (!hint.name || card.name === hint.name);
  const direct = indexedCard(bot.field, hint.index);
  return direct && matches(direct) ? direct : bot.field.find(matches);
}

/** Source resolution mirrors runtime executors, including index 0 and their hint precedence. */
export function fingerprintMainPhaseAction(action: AIPlannedAction, game: MainPhaseIdentityGame, bot: BotRuntimePort): string {
  const { references } = runtimeReferences(game, bot);
  function sourceIdentity(card: object | null | undefined, role = "source"): string {
    if (!card) throw new TypeError(`Unresolved main-phase action ${role}`);
    return references.get(card) ?? instanceIdentity(card, `${bot.id}/${role}`);
  }
  if (action.type === "simulatedBattle") {
    // TurnLineSearch also emits aggregate summaries without a source card.
    // The runtime consumes this action as a phase bridge; attack summaries
    // remain planning diagnostics rather than choices executed here.
    return JSON.stringify(canonicalize({ actor: bot.id, type: action.type, phaseBridge: action.phaseBridge }, references));
  }
  let source: GameCard | object | null | undefined;
  let zone: string;
  let choices: object = {};
  switch (action.type) {
    case "summon":
    case "handSummonProcedure":
    case "handIgnition":
    case "special_summon_sanctum_protector":
      zone = "hand";
      source = bot.hand[resolveHandIndexForAction(bot, action, "monster")];
      if (action.type === "summon") choices = { position: action.position, facedown: action.facedown, tributes: action.tributeIndices?.map(index => sourceIdentity(bot.field[index], "tribute")) };
      if (action.type === "handSummonProcedure") {
        const materials = resolveHandProcedureMaterials(bot, action.materials);
        if (!materials) throw new TypeError("Unresolved hand procedure materials");
        choices = { position: action.position || "attack", materials: materials.map(material => sourceIdentity(material, "material")) };
      }
      if (action.type === "special_summon_sanctum_protector") {
        const material = Number.isInteger(action.materialIndex) ? indexedCard(bot.field, action.materialIndex) : bot.field.find(card => card.name === "Luminarch Aegisbearer" && !card.isFacedown);
        choices = { position: action.position === "attack" ? "attack" : "defense", material: sourceIdentity(material, "material") };
      }
      break;
    case "spell":
    case "set_spell_trap":
      zone = "hand";
      source = bot.hand[resolveHandIndexForAction(bot, action, action.type === "spell" ? "spell" : ["spell", "trap"])];
      if (action.type === "spell") choices = { fusionTarget: action.fusionTarget, fusionTargetHint: action.fusionTargetHint };
      break;
    case "monsterEffect":
    case "position_change":
      zone = "field";
      source = fieldOrGraveSource(bot.field, action.fieldIndex, action);
      if (action.type === "position_change") choices = { position: action.toPosition };
      break;
    case "graveyardMonsterEffect":
    case "graveyardSpellEffect":
      zone = "graveyard";
      source = fieldOrGraveSource(bot.graveyard, action.graveyardIndex, action);
      break;
    case "spellTrapEffect":
      zone = "spellTrap";
      source = indexedCard(bot.spellTrap, Number.isInteger(action.zoneIndex) ? action.zoneIndex : action.index);
      break;
    case "fieldEffect":
      zone = "fieldSpell";
      source = bot.fieldSpell;
      break;
    case "ascension":
      zone = "extraDeck";
      source = action.ascensionCard;
      choices = { position: action.position, material: sourceIdentity(indexedCard(bot.field, action.materialIndex), "material") };
      break;
    case "extraDeckProcedure": {
      zone = "extraDeck";
      source = extraDeckSource(bot, action);
      const hints = action.materials ?? (action.materialIndices ?? []).map((index, offset) => ({ index, id: action.materialIds?.[offset], name: action.materialNames?.[offset], instanceIds: action.materialInstanceIds?.[offset] }));
      choices = { position: action.position || "attack", summonProcedure: action.summonProcedure, materials: hints.map(hint => sourceIdentity(extraDeckMaterial(bot, hint), "material")) };
      break;
    }
    default: {
      const exhaustive: never = action;
      throw new TypeError(`Unsupported main-phase action: ${String(exhaustive)}`);
    }
  }
  const context = action.activationContext;
  const activation = context ? {
    effect: context.effect,
    effectId: context.effectId,
    fromHand: context.fromHand,
    activationZone: context.activationZone,
    sourceZone: context.sourceZone,
    zone: context.zone,
    trapActivationFromSet: context.trapActivationFromSet,
    autoSelectTargets: context.autoSelectTargets,
    autoSelectSingleTarget: context.autoSelectSingleTarget,
    actionContext: context.actionContext,
    targetPreferences: context.targetPreferences,
    blueprintSourceCardId: context.blueprintSourceCardId,
    blueprintId: context.blueprintId,
  } : {};
  return JSON.stringify(canonicalize({ actor: bot.id, type: action.type, zone, source: sourceIdentity(source), effectId: action.effectId || action.effect?.id || context?.effectId || context?.effect?.id, activation, choices }, references));
}
