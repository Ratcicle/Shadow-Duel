import type { DragonCard as DragonReadCard, DragonPlayer as DragonReadPlayer } from "./contracts.js";
// ─────────────────────────────────────────────────────────────────────────────
// src/core/ai/dragon/simulation.js
// Lookahead simulation for Dragon deck (BeamSearch / greedy).
// ─────────────────────────────────────────────────────────────────────────────

import {
  CARD_KNOWLEDGE,
  CURRENT_AWAKENING_TARGET_NAMES,
  isExtremeDragon,
} from "./knowledge.js";
import { getTributeRequirementFor, selectBestTributes } from "./priorities.js";
import { rankDragonSearchCandidates } from "./searchPolicy.js";
import { rankDragonDiscardCandidates } from "./costPolicy.js";
import {
  rankDragonFieldBanishCosts,
  rankDragonGyBanishCosts,
  rankTechVoidBanishTargets,
  shouldUsePurifiedBanishSummon,
  shouldUseStelyaBanishSummon,
} from "./banishPolicy.js";
import { getLuminescentBattleDebuffPlan } from "./battleDefensePolicy.js";
import { selectBestDragonBoss } from "./bossPolicy.js";
import { evaluateDragonRecruitCandidate } from "./actionPolicy.js";
import { selectDragonFusionPlan } from "./extraDeckPolicy.js";
import { getEffectiveAtk } from "../common/cardStats.js";
import { isValidBoneflameCost } from "./boneflamePolicy.js";
import { ascensionMaterialMatches } from "../../game/summon/ascension.js";
import {
  fieldHasTributeValue,
  getTributeCardsFromIndices,
  getTributeValueTotal,
} from "../../game/summon/tributeValue.js";
import {
  canUseNormalSummonForCard,
  recordNormalSummonForTurn,
} from "../../Player.js";
import type {
  AIActionType,
  AIPlannedAction,
  AITributeRequirement,
} from "../../contracts/ai.js";
import type {
  AiLiveGamePort,
  SimulatedCardState,
  SimulatedPlayerState,
  SimulationGameState,
} from "../../contracts/aiState.js";
import type { ActionType, CardAction } from "../../contracts/actions.js";
import type {
  AlternateTributeDefinition,
  BattlePosition,
  BattlePositionInput,
  CardKind,
  GameCard,
  MonsterType,
} from "../../contracts/cards.js";
import type {
  CardFilter,
  EffectDefinition,
  EffectTarget,
  PassiveRuleDefinition,
} from "../../contracts/effects.js";
import type { PlayerId } from "../../contracts/primitives.js";
import type { CanonicalZone, ZoneInput } from "../../contracts/zones.js";

type DragonCounterObject = Partial<Record<string, number>>;
type DragonCard = Omit<SimulatedCardState, "counters"> & {
  counters?: ReadonlyMap<string, number> | DragonCounterObject;
};
type DragonPlayer = Omit<
  SimulatedPlayerState,
  | "hand"
  | "field"
  | "graveyard"
  | "deck"
  | "extraDeck"
  | "banished"
  | "fieldSpell"
  | "spellTrap"
  | "_simMaterialEffectActivationsByMaterialId"
> & {
  hand: DragonCard[];
  field: DragonCard[];
  graveyard: DragonCard[];
  deck: DragonCard[];
  extraDeck: DragonCard[];
  banished: DragonCard[];
  fieldSpell: DragonCard | null;
  spellTrap: DragonCard[];
  _simMaterialEffectActivationsByMaterialId?: DragonNumericMapLike;
};
type DragonZoneName =
  | CanonicalZone
  | "banish";

interface DragonMaterialStatsPlayer {
  effectActivationsByMaterialId?: DragonNumericMapLike;
}

interface DragonMaterialStats {
  player?: DragonMaterialStatsPlayer;
  bot?: DragonMaterialStatsPlayer;
}

interface DragonGameReference extends Omit<AiLiveGamePort, "player" | "bot" | "_gameRef"> {
  player: DragonReadPlayer;
  bot: DragonReadPlayer;
  _gameRef?: DragonGameReference;
  materialDuelStats?: DragonMaterialStats;
}

type DragonSimulationState = Omit<
  SimulationGameState,
  | "player"
  | "bot"
  | "opponent"
  | "_gameRef"
  | "_dragonSimOnce"
  | "_simMaterialEffectActivationsByMaterialId"
> & {
  player: DragonPlayer;
  bot: DragonPlayer;
  opponent?: DragonPlayer | null;
  _gameRef?: DragonGameReference;
  _dragonSimOnce?: DragonOnceLedger;
  _simMaterialEffectActivationsByMaterialId?: DragonMaterialLedger;
  game?: DragonGameReference | null;
  materialDuelStats?: DragonMaterialStats;
};

interface DragonSimulationAction {
  type?: AIActionType | ActionType | "simulatedBattle";
  index?: number;
  fieldIndex?: number;
  zoneIndex?: number;
  graveyardIndex?: number;
  materialIndex?: number;
  materialId?: number;
  cardId?: number;
  cardName?: string;
  effectId?: string | null;
  position?: BattlePositionInput;
  facedown?: boolean;
  toPosition?: "attack" | "defense";
  ascensionCard?: DragonCard | GameCard | null;
  filters?: CardFilter;
  cardKind?: CardKind | readonly CardKind[];
  minLevel?: number;
  maxLevel?: number;
  zone?: ZoneInput | readonly ZoneInput[];
  sourceZone?: ZoneInput | readonly ZoneInput[];
  fromZone?: ZoneInput;
  to?: CanonicalZone;
  targetRef?: string;
  requireSource?: boolean;
  resultRef?: string;
  count?: {
    readonly min?: number;
    readonly max?: number;
  };
}

interface DragonCandidateEntry {
  candidate: DragonCard;
  index: number;
  owner?: DragonPlayer;
  zoneName?: DragonZoneName;
}

type DragonArrayZoneName = Exclude<DragonZoneName, "fieldSpell" | "banish">;

interface DragonZonedCandidateEntry extends DragonCandidateEntry {
  zoneName: DragonArrayZoneName;
}

interface DragonTargetSelection extends DragonCandidateEntry {
  owner: DragonPlayer;
  zoneName: DragonZoneName;
}

interface DragonMaterialEntry {
  zone: "hand" | "field";
  index: number;
  card: DragonCard;
}

type DragonMaterialValueEntry = Pick<DragonMaterialEntry, "card" | "zone">;

interface DragonFieldSpellCandidateEntry extends DragonCandidateEntry {
  zone: "hand" | "deck" | "graveyard";
}

interface DragonCardKnowledge {
  value?: number;
  priority?: number;
}

type DragonNumericMapLike = Partial<Record<string | number, number>> & {
  get?: (key: string | number | undefined) => number | undefined;
};

type DragonZoneStorage = Partial<
  Record<DragonArrayZoneName | "banish", DragonCard[]>
>;
type DragonZoneStorageKey = keyof DragonZoneStorage;

type DragonAlternateTributeView = AlternateTributeDefinition & {
  readonly requiresName?: string;
  readonly requiresType?: string;
};

type DragonTargetSelectionMap = Record<string, DragonTargetSelection[]>;

type DragonOnceBucket = Partial<Record<string, boolean>>;
type DragonMaterialBucket = Partial<Record<string | number, number>>;
type DragonOnceLedger = Partial<Record<PlayerId, DragonOnceBucket>>;
type DragonMaterialLedger = Partial<Record<PlayerId, DragonMaterialBucket>>;

interface DragonCostSelectionOptions {
  preserveNames?: readonly string[];
}

interface DragonSpecialSummonOptions {
  position?: BattlePositionInput;
  cannotAttackThisTurn?: boolean;
  skipAfterSummon?: boolean;
  method?: "normal" | "tribute" | "special" | "fusion" | "ascension";
}

interface DragonSummonActionView {
  position?: BattlePositionInput | "any";
  effectId?: string | null;
}

interface DragonSummonMetadata {
  method?: DragonSpecialSummonOptions["method"];
}

interface DragonFallbackCard {
  name: string;
  atk: number;
  def: number;
  level: number;
  cardKind: "monster";
  type: string;
  attribute?: string;
  monsterType: MonsterType;
}

interface DragonDiscardContext {
  state?: DragonSimulationState | null;
  player?: DragonPlayer;
  source?: DragonCard | null;
  effect?: DragonEffectReference | null;
}

interface DragonDiscardFallbackState {
  bot: DragonPlayer | object;
  player: DragonPlayer | object;
}

interface DragonBanishContext {
  player: DragonPlayer;
  bot: DragonPlayer;
  opponent: DragonPlayer;
  game: DragonGameReference | DragonSimulationState | null;
  isSimulatedState: true;
  source: DragonCard | null;
  sourceCard: DragonCard | null;
  action: DragonSimulationAction | null;
  effectId?: string | null;
}

type DragonEffectReference = EffectDefinition | { readonly id: string };

interface DragonRecruitEvaluationScore {
  card: DragonCard;
}

interface DragonRecruitEvaluation {
  blockedAll?: boolean;
  scores?: DragonRecruitEvaluationScore[];
}

type DragonFusionPlan =
  | { ok: false; reason?: string }
  | {
      ok: true;
      fusionName: string;
      materialEntries: DragonMaterialEntry[];
      reason: string;
      score: number;
    };

interface DragonBossSelectionContext {
  player: DragonPlayer;
  bot: DragonPlayer;
  opponent: DragonPlayer;
  game: DragonSimulationState;
  routeKind: string;
  fieldCostCount: number;
  isSimulatedState: true;
}

interface DragonLuminescentDebuffPlan {
  ok?: boolean;
  target?: DragonCard | null;
  preferredNames?: string[];
}

const AWAKENING_TARGET_ORDER = [...CURRENT_AWAKENING_TARGET_NAMES];

const CONVERGING_SUMMON_ORDER = [
  "Darkness Dragon",
  "Abyssal Serpent Dragon",
  "Majestic Silver Dragon",
  "Black Bull Dragon",
  "Purified Crystal Dragon",
  "Volcanic Extreme Dragon",
  "Galaxy Extreme Dragon",
  "Forest Extreme Dragon",
  "Fire Extreme Dragon",
  "Mist Extreme Dragon",
];

const EXTREME_GY_SEND_ORDER = [
  "Volcanic Extreme Dragon",
  "Fire Extreme Dragon",
  "Forest Extreme Dragon",
  "Galaxy Extreme Dragon",
  "Mist Extreme Dragon",
];

function tributeMatchesAltRequirement(
  card: DragonCard | undefined,
  alt: AlternateTributeDefinition | null | undefined,
): boolean {
  if (!card || card.cardKind !== "monster" || !alt) return false;
  if (card.isFacedown) return false;
  if (
    (alt as DragonAlternateTributeView).requiresName &&
    card.name !== (alt as DragonAlternateTributeView).requiresName
  ) return false;
  if (
    (alt as DragonAlternateTributeView).requiresType &&
    card.type !== (alt as DragonAlternateTributeView).requiresType
  ) return false;
  return true;
}

/**
 * Simulates a main-phase action on a cloned game state.
 * @param state Cloned game state.
 * @param action Action to simulate.
 * @returns Modified state.
 */
export function simulateMainPhaseAction(
  state: DragonSimulationState,
  action: AIPlannedAction,
): DragonSimulationState {
  if (!action || !state?.bot) return state;

  switch (action.type) {
    case "summon": {
      const player = state.bot;
      const card = player.hand[action.index!];
      if (!card) break;
      if (!canUseNormalSummonForCard(player, card)) break;

      const tributeInfo = (getTributeRequirementFor as (
        card: DragonCard,
        player: DragonPlayer,
      ) => AITributeRequirement)(card, player);

      if (
        tributeInfo.tributesNeeded > 0 &&
        !fieldHasTributeValue(player.field || [], tributeInfo.tributesNeeded, card)
      ) {
        break; // Can't tribute summon
      }

      // Remove tributes
      if (tributeInfo.tributesNeeded > 0) {
        const tributeIndices = (selectBestTributes as (
          field: DragonCard[],
          tributesNeeded: number,
          cardToSummon?: DragonCard | null,
        ) => number[])(
          player.field,
          tributeInfo.tributesNeeded,
          card,
        );
        const tributeCards = getTributeCardsFromIndices(player.field, tributeIndices);
        if (getTributeValueTotal(tributeCards, card) < tributeInfo.tributesNeeded) {
          break;
        }
        if (
          tributeInfo.usingAlt === true &&
          tributeInfo.alt &&
          !tributeIndices
            .slice(0, tributeInfo.tributesNeeded)
            .some((idx) => tributeMatchesAltRequirement(player.field[idx], tributeInfo.alt))
        ) {
          break;
        }
        tributeIndices.sort((a, b) => b - a);
        tributeIndices.forEach((idx) => {
          const t = player.field[idx];
          if (t) {
            player.graveyard.push(t);
            player.field.splice(idx, 1);
          }
        });
      }

      // Move card from hand to field
      player.hand.splice(action.index!, 1);
      player.field.push({
        ...card,
        position: (action.position || "attack") as BattlePosition,
        isFacedown: action.facedown || false,
        hasAttacked: false,
      });
      player.summonCount = (player.summonCount || 0) + 1;
      const summoned = player.field[player.field.length - 1];
      recordNormalSummonForTurn(player, summoned);
      simulateDragonAfterSummonEffects(state, summoned, {
        method: tributeInfo.tributesNeeded > 0 ? "tribute" : "normal",
      });
      break;
    }

    case "spell": {
      const player = state.bot;
      const card = player.hand[action.index!];
      if (!card) break;

      player.hand.splice(action.index!, 1);

      simulateDragonSpellEffect(state, card, action);

      if (card.subtype === "field") {
        player.fieldSpell = { ...card };
      } else if (card.subtype === "continuous" || card.subtype === "equip") {
        if (!player.spellTrap) player.spellTrap = [];
        if (player.spellTrap.length < 5) player.spellTrap.push({ ...card });
        else player.graveyard.push({ ...card });
      } else {
        player.graveyard.push({ ...card });
      }
      break;
    }

    case "handIgnition": {
      const player = state.bot;
      const card = player.hand[action.index!];
      if (!card) break;

      simulateDragonHandIgnition(state, card, action);
      break;
    }

    case "graveyardMonsterEffect": {
      const player = state.bot;
      const graveyardIndex = Number.isInteger(action.graveyardIndex)
        ? action.graveyardIndex
        : (player.graveyard || []).findIndex(
            (card) =>
              card &&
              (card.id === action.cardId ||
                (!action.cardId && card.name === action.cardName)),
          );
      const card = player.graveyard?.[graveyardIndex!];
      if (!card) break;

      simulateDragonGraveyardMonsterEffect(state, card, action);
      break;
    }

    case "spellTrapEffect": {
      const player = state.bot;
      const zoneIndex = Number.isInteger(action.zoneIndex)
        ? action.zoneIndex
        : action.index;
      const card = player.spellTrap?.[zoneIndex!];
      if (!card) break;
      simulateDragonSpellTrapIgnition(state, card, action, zoneIndex!);
      break;
    }

    case "fieldEffect": {
      const player = state.bot;
      const card = player.fieldSpell;
      if (!card) break;
      simulateDragonFieldSpellEffect(state, card, action);
      break;
    }

    case "monsterEffect": {
      const player = state.bot;
      const fieldIndex = Number.isInteger(action.fieldIndex)
        ? action.fieldIndex
        : (player.field || []).findIndex(
            (card) =>
              card &&
              (card.id === action.cardId ||
                (!action.cardId && card.name === action.cardName)),
          );
      const card = player.field?.[fieldIndex!];
      if (!card) break;
      simulateDragonFieldMonsterEffect(state, card, action, fieldIndex!);
      break;
    }

    case "graveyardSpellEffect": {
      const player = state.bot;
      const graveyardIndex = Number.isInteger(action.graveyardIndex)
        ? action.graveyardIndex
        : (player.graveyard || []).findIndex(
            (card) =>
              card &&
              (card.id === action.cardId ||
                (!action.cardId && card.name === action.cardName)),
          );
      const card = player.graveyard?.[graveyardIndex!];
      if (!card) break;
      simulateDragonGraveyardSpellEffect(state, card, action, graveyardIndex!);
      break;
    }

    case "set_spell_trap": {
      const player = state.bot;
      const card = player.hand[action.index!];
      if (!card) break;
      if (card.cardKind === "spell" && card.subtype === "field") break;
      player.hand.splice(action.index!, 1);
      player.spellTrap = player.spellTrap || [];
      if (player.spellTrap.length < 5) {
        player.spellTrap.push({ ...card, isFacedown: true });
      } else {
        player.graveyard.push({ ...card });
      }
      break;
    }

    case "position_change": {
      const player = state.bot;
      const target = (player.field || []).find(
        (c) => c && (c.id === action.cardId || c.name === action.cardName),
      );
      if (!target || target.positionChangedThisTurn || target.hasAttacked) break;
      if (target.isFacedown) {
        target.isFacedown = false;
        target.position = "attack";
        target.positionChangedThisTurn = true;
        break;
      }
      const newPos = action.toPosition === "defense" ? "defense" : "attack";
      if (target.position === newPos) break;
      target.position = newPos;
      target.positionChangedThisTurn = true;
      break;
    }

    case "ascension": {
      simulateDragonAscension(state, action);
      break;
    }
  }

  return state;
}

/**
 * Simulates spell-specific effects on the cloned state.
 * @param state Cloned game state.
 * @param card Spell being simulated.
 * @param action Planned action metadata.
 */
function simulateDragonSpellEffect(
  state: DragonSimulationState,
  card: DragonCard,
  action: DragonSimulationAction,
): void {
  const player = state.bot;

  switch (card.name) {
    case "Extreme Dragon Awakening": {
      const effect = (card.effects || []).find(
        (entry) => entry?.id === "extreme_dragon_awakening_gy_search",
      );
      const action: DragonSimulationAction = {
        type: "add_from_zone_to_hand",
        zone: "deck",
        filters: { cardKind: "monster", type: "Dragon" },
        minLevel: 8,
      };
      const target = rankSearchEntriesForSimulation(
        (player.deck || [])
          .map((candidate, index) => ({ candidate, index }))
          .filter(
            ({ candidate }) =>
              isDragonMonster(candidate) &&
              (candidate.level || 0) >= 8,
          ),
        state,
        action,
        card,
        effect,
      )[0];

      if (target) {
        const searched = player.deck.splice(target.index, 1)[0];
        player.hand.push(searched);
      }
      break;
    }

    case "Converging Stars": {
      // Step 1: discard 1 card from hand.
      if (player.hand.length > 0) {
        const discardIdx = pickWorstDiscard(player.hand, {
          state,
          player,
          source: card,
        });
        discardHandCardToGraveyard(state, player, discardIdx);
      }

      // Step 2: Reduce all hand monster levels by 2
      player.hand = player.hand.map((c) => {
        if (c.cardKind === "monster" && (c.level || 0) > 1) {
          return { ...c, level: Math.max(1, (c.level || 0) - 2) };
        }
        return c;
      });

      // Step 3: approximate the immediate normal summon that the level reduction unlocks.
      simulateBestConvergingSummon(state, player, action);
      break;
    }

    case "Polymerization": {
      const materialEntries = getFusionMaterialEntries(player);
      const fusionPlan = (selectDragonFusionPlan as (
        context: object,
      ) => DragonFusionPlan | null)({
        player,
        bot: player,
        opponent: state.player || {},
        game: state,
        isSimulatedState: true,
        materialEntries,
      });
      if (!fusionPlan?.ok) break;

      const canPlace =
        (fusionPlan.materialEntries || []).length > 0 &&
        (
          player.field.length < 5 ||
          fusionPlan.materialEntries.some((entry) => entry.zone === "field")
        );
      if (!canPlace) break;

      if (fusionPlan.fusionName === "Tech-Void Dragon") {
        moveFusionMaterialsToGY(player, fusionPlan.materialEntries);
        const techVoidCard = takeExtraDeckCard(player, "Tech-Void Dragon", {
          name: "Tech-Void Dragon",
          atk: 2500,
          def: 1000,
          level: 8,
          cardKind: "monster",
          type: "Dragon",
          monsterType: "fusion",
        });
        const summoned = specialSummonToField(state, player, techVoidCard, action, {
          method: "fusion",
        });
        if (summoned) {
          summoned.simDragonExtraDeckPlan = fusionPlan.reason;
          summoned.simDragonExtraDeckScore = fusionPlan.score;
          simulateTechVoidAfterSummon(state, player, summoned);
        }
        break;
      }

      if (fusionPlan.fusionName === "Radiant Cosmic Dragon") {
        moveFusionMaterialsToGY(player, fusionPlan.materialEntries);
        const radiantCard = takeExtraDeckCard(player, "Radiant Cosmic Dragon", {
          name: "Radiant Cosmic Dragon",
          atk: 3300,
          def: 2700,
          level: 9,
          cardKind: "monster",
          type: "Dragon",
          attribute: "Light",
          monsterType: "fusion",
        });
        const summoned = specialSummonToField(state, player, radiantCard, action, {
          method: "fusion",
        });
        if (summoned) {
          summoned.simDragonExtraDeckPlan = fusionPlan.reason;
          summoned.simDragonExtraDeckScore = fusionPlan.score;
          summoned.simFutureRevive = (player.graveyard || []).some(
            (candidate) =>
              isDragonMonster(candidate) && candidate.name !== "Radiant Cosmic Dragon",
          );
          simulateRadiantCosmicRefund(player);
        }
      }
      break;
    }

    case "Jagged Peak of the Dragons": {
      // Field spell — placement already handled by caller
      // Simulate GY recovery: add 1 lv4- Dragon from GY to hand
      const lv4GYIdx = (player.graveyard || []).findIndex(
        (c) => c.cardKind === "monster" && (c.level || 0) <= 4 && (c.type === "Dragon" || c.cardKind === "monster")
      );
      if (lv4GYIdx >= 0) {
        const recovered = player.graveyard.splice(lv4GYIdx, 1)[0];
        player.hand.push(recovered);
      }
      break;
    }

    case "Hellkite Roar": {
      // Destroy up to 1 opp spell/trap - approximate by removing one backrow from state.
      const opp = state.player;
      if (opp?.spellTrap?.length > 0) {
        const destroyed = opp.spellTrap.shift();
        if (destroyed) putSimulatedCard(opp, destroyed, "graveyard");
      } else if (opp?.fieldSpell) {
        const destroyed = opp.fieldSpell;
        opp.fieldSpell = null;
        putSimulatedCard(opp, destroyed, "graveyard");
      }
      break;
    }

    default:
      break;
  }
}

function isDragonMonster(
  card: DragonCard | null | undefined,
): card is DragonCard {
  return card?.cardKind === "monster" && card.type === "Dragon";
}

function getFusionMaterialEntries(player: DragonPlayer): DragonMaterialEntry[] {
  const entries: DragonMaterialEntry[] = [];
  for (const zone of ["hand", "field"] as const) {
    const cards = (player as DragonZoneStorage)?.[zone] || [];
    for (let index = 0; index < cards.length; index++) {
      const card = cards[index];
      if (isDragonMonster(card)) {
        entries.push({ zone, index, card });
      }
    }
  }
  return entries;
}

function materialValue(entry: DragonMaterialValueEntry): number {
  const card = entry?.card || ({} as DragonCard);
  const knowledge = (CARD_KNOWLEDGE as Partial<
    Record<string, DragonCardKnowledge>
  >)[card.name as string] || {};
  return (
    (knowledge.value || 0) +
    (card.level || 0) * 0.2 +
    (card.atk || 0) / 1000 +
    (entry.zone === "field" ? 1 : 0)
  );
}

function cardStrategicSimValue(card: DragonReadCard | null | undefined): number {
  const knowledge = (CARD_KNOWLEDGE as Partial<
    Record<string, DragonCardKnowledge>
  >)[card?.name as string] || {};
  return (
    (knowledge.value || knowledge.priority || 0) +
    (card?.level || 0) * 0.25 +
    Math.max(card?.atk || 0, card?.def || 0) / 1000 +
    (isExtremeDragon(card) ? 4 : 0) +
    (card?.monsterType === "fusion" || card?.monsterType === "ascension" ? 5 : 0)
  );
}

function rankSimThreats(cards: readonly DragonCard[] = []): DragonCard[] {
  return (cards || [])
    .filter((card) => card && card.cardKind === "monster")
    .slice()
    .sort((a, b) => {
      const score = (card: DragonCard) =>
        Math.max(card?.atk || 0, card?.def || 0) / 500 +
        (card?.level || 0) * 0.35 +
        (card?.monsterType === "fusion" || card?.monsterType === "ascension" ? 5 : 0);
      return score(b) - score(a);
    });
}

function isFaceupDragon(
  card: DragonCard | null | undefined,
): card is DragonCard {
  return isDragonMonster(card) && !card.isFacedown;
}

function hasNamedCard(
  cards: readonly DragonCard[] = [],
  name: string,
): boolean {
  return (cards || []).some((card) => card?.name === name);
}

function cardArchetypes(card: DragonCard | null | undefined): string[] {
  if (!card) return [];
  if (Array.isArray(card.archetypes)) return card.archetypes;
  return card.archetype ? [card.archetype] : [];
}

function hasArchetype(
  card: DragonCard | null | undefined,
  archetype: string,
): boolean {
  return cardArchetypes(card).includes(archetype);
}

function hasRainbowGyFollowUp(player: DragonPlayer): boolean {
  if (hasNamedCard(player?.hand, "Call of the Haunted")) return true;
  if (hasNamedCard(player?.spellTrap, "Call of the Haunted")) return true;
  if ((player?.field || []).some((card) => card?.name === "Luminous Dragon" && !card.isFacedown)) {
    return true;
  }
  if (
    hasNamedCard(player?.graveyard, "Boneflame Dragon") &&
    (player?.field || []).some(isFaceupDragon)
  ) {
    return true;
  }
  if (player?.fieldSpell?.name === "Jagged Peak of the Dragons") return true;
  return hasNamedCard(player?.hand, "Hellkite Dragon");
}

function orderBonus(
  card: DragonCard | null | undefined,
  order: readonly string[] = [],
  step = 12,
): number {
  const index = order.indexOf(card?.name as string);
  return index >= 0 ? (order.length - index) * step : 0;
}

function getPlayerId(
  state: DragonSimulationState,
  owner: DragonPlayer,
): PlayerId {
  if (owner?.id === "player" || owner?.id === "bot") return owner.id;
  return owner === state?.player ? "player" : "bot";
}

function readMapLike(
  value: DragonNumericMapLike | null | undefined,
  key: string | number | undefined,
): number {
  if (!value) return 0;
  if (typeof value.get === "function") return value.get(key) || 0;
  return value[key as string | number] || value[String(key)] || 0;
}

function getMaterialEffectActivationCount(
  state: DragonSimulationState,
  owner: DragonPlayer,
  materialId: string | number | undefined,
): number {
  const playerId = getPlayerId(state, owner);
  const realGame = state?._gameRef || state;
  return (
    readMapLike(
      realGame?.materialDuelStats?.[playerId]
        ?.effectActivationsByMaterialId,
      materialId,
    ) +
    readMapLike(
      state?._simMaterialEffectActivationsByMaterialId?.[playerId],
      materialId,
    ) +
    readMapLike(owner?._simMaterialEffectActivationsByMaterialId, materialId)
  );
}

function recordSimulatedMaterialEffectActivation(
  state: DragonSimulationState,
  owner: DragonPlayer,
  sourceCard: DragonCard,
): void {
  if (!state || !owner || !sourceCard || sourceCard.cardKind !== "monster") return;
  if (typeof sourceCard.id !== "number") return;
  const playerId = getPlayerId(state, owner);
  if (!state._simMaterialEffectActivationsByMaterialId) {
    state._simMaterialEffectActivationsByMaterialId = { player: {}, bot: {} };
  }
  const bucket =
    state._simMaterialEffectActivationsByMaterialId[playerId] ||
    (state._simMaterialEffectActivationsByMaterialId[playerId] = {});
  bucket[sourceCard.id] = (bucket[sourceCard.id] || 0) + 1;
}

function getSimulatedOnceBucket(
  state: DragonSimulationState,
  owner: DragonPlayer,
): DragonOnceBucket | null {
  if (!state) return null;
  const playerId = getPlayerId(state, owner);
  if (!state._dragonSimOnce) state._dragonSimOnce = { player: {}, bot: {} };
  return state._dragonSimOnce[playerId] || (state._dragonSimOnce[playerId] = {});
}

function canUseSimulatedOnce(
  state: DragonSimulationState,
  owner: DragonPlayer,
  key: string | null,
): boolean {
  if (!state || !key) return true;
  const bucket = getSimulatedOnceBucket(state, owner);
  return !bucket?.[key];
}

function useSimulatedOnce(
  state: DragonSimulationState,
  owner: DragonPlayer,
  key: string | null,
): boolean {
  if (!state || !key) return true;
  const bucket = getSimulatedOnceBucket(state, owner);
  if (bucket![key]) return false;
  bucket![key] = true;
  return true;
}

function getSimulatedEffectOnceKey(
  effect: EffectDefinition | null | undefined,
): string | null {
  if (!effect?.oncePerTurn) return null;
  return effect.oncePerTurnName || effect.id || null;
}

function putSimulatedCard(
  owner: DragonPlayer,
  card: DragonCard,
  toZone: DragonZoneName,
): void {
  if (!owner || !card || !toZone) return;
  const destination = toZone === "banish" ? "banished" : toZone;
  const zone =
    destination === "deck" &&
    (card.monsterType === "fusion" || card.monsterType === "ascension")
      ? "extraDeck"
      : destination;

  if (zone === "fieldSpell") {
    owner.fieldSpell = card;
    return;
  }

  if (!(owner as DragonZoneStorage)[zone]) {
    (owner as DragonZoneStorage)[zone] = [];
  }
  (owner as DragonZoneStorage)[zone]!.push(card);
}

function moveFieldIndexToGraveyard(
  player: DragonPlayer,
  index: number,
): DragonCard | null {
  const card = player?.field?.[index];
  if (!card) return null;
  player.field.splice(index, 1);
  putSimulatedCard(player, card, "graveyard");
  return card;
}

function discardHandCardToGraveyard(
  state: DragonSimulationState,
  player: DragonPlayer,
  handIndex: number,
): DragonCard | null {
  const discarded = player?.hand?.[handIndex];
  if (!discarded) return null;
  player.hand.splice(handIndex, 1);
  putSimulatedCard(player, discarded, "graveyard");
  applyDragonHandToGraveyardTriggers(state, player, discarded);
  return discarded;
}

function applyDragonHandToGraveyardTriggers(
  state: DragonSimulationState,
  player: DragonPlayer,
  discarded: DragonCard,
): void {
  if (!state || !player || !discarded || !isDragonMonster(discarded)) return;
  const opponent = player === state.player ? state.bot : state.player;

  if (
    discarded.name === "Voltaic Dragon" &&
    useSimulatedOnce(state, player, "voltaic_dragon_discard_damage")
  ) {
    opponent.lp = (opponent.lp ?? 8000) - 800;
  }

  const hasFaceupLuminous = (player.field || []).some(
    (card) => card?.name === "Luminous Dragon" && !card.isFacedown,
  );
  if (
    hasFaceupLuminous &&
    useSimulatedOnce(state, player, "luminous_dragon_discard_recover")
  ) {
    const recoverEntry = (player.graveyard || [])
      .map((candidate, index) => ({ candidate, index }))
      .filter(
        ({ candidate }) =>
          isDragonMonster(candidate) && candidate.name !== discarded.name,
      )
      .sort((a, b) => cardStrategicSimValue(b.candidate) - cardStrategicSimValue(a.candidate))[0];

    if (recoverEntry) {
      const liveIndex = player.graveyard.indexOf(recoverEntry.candidate);
      if (liveIndex >= 0) {
        player.hand.push(player.graveyard.splice(liveIndex, 1)[0]);
      }
    }
  }
}

function rankSearchEntriesForSimulation<Entry extends DragonCandidateEntry>(
  entries: readonly Entry[],
  state: DragonSimulationState,
  action: DragonSimulationAction,
  source: DragonCard,
  effect: EffectDefinition | null = null,
): Entry[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const rankedCards = rankDragonSearchCandidates(
    (entries as readonly Entry[]).map((entry) => entry.candidate),
    action,
    {
      player: state?.bot,
      opponent: state?.player,
      game: state,
      source,
      ctx: { effect },
      isSimulatedState: true,
      fallbackValue: cardStrategicSimValue,
    },
  );
  const ranks = new Map(rankedCards.map((card, index) => [card, index]));
  return (entries as readonly Entry[])
    .slice()
    .sort(
      (a, b) =>
        (ranks.get(a.candidate) ?? 9999) -
          (ranks.get(b.candidate) ?? 9999) ||
        a.index - b.index,
    );
}

function rankRecruitEntriesForSimulation<Entry extends DragonCandidateEntry>(
  entries: readonly Entry[],
  state: DragonSimulationState,
  action: DragonSimulationAction,
  source: DragonCard,
  effect: EffectDefinition | null = null,
): Entry[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const evaluation = (evaluateDragonRecruitCandidate as (
    candidates: DragonCard[],
    context: object,
  ) => DragonRecruitEvaluation)(
    (entries as readonly Entry[]).map((entry) => entry.candidate),
    {
      player: state?.bot,
      opponent: state?.player,
      game: state,
      source,
      sourceCard: source,
      action,
      effect,
      effectId: effect?.id || action?.effectId,
      isSimulatedState: true,
      fallbackValue: cardStrategicSimValue,
    },
  );
  if (evaluation?.blockedAll) return [];
  const ranks = new Map(
    (evaluation?.scores || []).map((entry, index) => [entry.card, index]),
  );
  return (entries as readonly Entry[])
    .slice()
    .sort(
      (a, b) =>
        (ranks.get(a.candidate) ?? 9999) -
          (ranks.get(b.candidate) ?? 9999) ||
        a.index - b.index,
    );
}

function rankDiscardEntriesForSimulation<Entry extends DragonCandidateEntry>(
  entries: readonly Entry[],
  state: DragonSimulationState | DragonDiscardFallbackState,
  source: DragonCard | null,
  effect: DragonEffectReference | null = null,
): Entry[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const rankedCards = rankDragonDiscardCandidates(
    (entries as readonly Entry[]).map((entry) => entry.candidate),
    {
      player: state?.bot,
      opponent: state?.player,
      game: state,
      source,
      effect,
      isSimulatedState: true,
      fallbackValue: cardStrategicSimValue,
    },
  );
  const ranks = new Map(rankedCards.map((card, index) => [card, index]));
  return (entries as readonly Entry[])
    .slice()
    .sort(
      (a, b) =>
        (ranks.get(a.candidate) ?? 9999) -
          (ranks.get(b.candidate) ?? 9999) ||
        a.index - b.index,
    );
}

function selectFieldDragonCosts(
  player: DragonPlayer,
  count: number,
  options: DragonCostSelectionOptions = {},
): DragonCandidateEntry[] {
  const preserveNames = new Set(options.preserveNames || []);
  return (player.field || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => isFaceupDragon(candidate))
    .sort((a, b) => {
      const score = (entry: DragonCandidateEntry) => {
        let value = materialValue({ card: entry.candidate, zone: "field" });
        if (isExtremeDragon(entry.candidate)) value += 1000;
        if (entry.candidate.monsterType === "fusion" || entry.candidate.monsterType === "ascension") {
          value += 80;
        }
        if (preserveNames.has(entry.candidate.name as string)) value += 50;
        if (entry.candidate.hasAttacked) value -= 1;
        return value;
      };
      return score(a) - score(b);
    })
    .slice(0, count);
}

function buildSimBanishContext(
  state: DragonSimulationState,
  player: DragonPlayer,
  sourceCard: DragonCard | null = null,
  action: DragonSimulationAction | null = null,
  extra: Pick<DragonBanishContext, "effectId"> = {},
): DragonBanishContext {
  return {
    ...extra,
    player,
    bot: player,
    opponent: state?.player || ({} as DragonPlayer),
    game: state?._gameRef || state?.game || null,
    isSimulatedState: true,
    source: sourceCard,
    sourceCard,
    action,
    effectId: action?.effectId,
  };
}

function selectStelyaFieldBanishCost(
  state: DragonSimulationState,
  player: DragonPlayer,
  sourceCard: DragonCard,
  action: DragonSimulationAction,
): DragonCandidateEntry | null {
  const entries = (player.field || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => isFaceupDragon(candidate));
  const context = buildSimBanishContext(state, player, sourceCard, action);
  const decision = shouldUseStelyaBanishSummon({
    ...context,
    candidates: entries.map(({ candidate }) => candidate),
  });
  if (!decision.ok) return null;
  return rankDragonFieldBanishCosts(entries, context)[0] || null;
}

function selectGraveyardDragonCosts(
  state: DragonSimulationState,
  player: DragonPlayer,
  count: number,
  sourceCard: DragonCard | null = null,
  action: DragonSimulationAction | null = null,
): DragonCandidateEntry[] {
  const context = buildSimBanishContext(state, player, sourceCard, action);
  return rankDragonGyBanishCosts(
    (player.graveyard || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => isDragonMonster(candidate)),
    context,
  )
    .slice(0, count);
}

function selectHandDragonDiscardCosts(
  state: DragonSimulationState,
  player: DragonPlayer,
  sourceCard: DragonCard,
  count: number,
): DragonCandidateEntry[] {
  const sourceIndex = player.hand.indexOf(sourceCard);
  const entries = (player.hand || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate, index }) => isDragonMonster(candidate) && index !== sourceIndex);
  return rankDiscardEntriesForSimulation(entries, state, sourceCard, {
    id: "bbd_special_summon_from_hand",
  })
    .slice(0, count);
}

function specialSummonToField(
  state: DragonSimulationState,
  player: DragonPlayer,
  card: DragonCard,
  action: DragonSummonActionView = {},
  options: DragonSpecialSummonOptions = {},
): DragonCard | null {
  if (!player || !card || (player.field || []).length >= 5) return null;
  const requestedPosition = action.position || options.position || "attack";
  const summoned = {
    ...card,
    position: (requestedPosition === "choice"
      ? "attack"
      : requestedPosition) as BattlePosition,
    isFacedown: false,
    hasAttacked: false,
    cannotAttackThisTurn: options.cannotAttackThisTurn === true,
  };
  applySimulatedPassiveBuffs(summoned, player);
  player.field.push(summoned);
  if (options.skipAfterSummon !== true) {
    simulateDragonAfterSummonEffects(state, summoned, {
      method: options.method || "special",
    });
  }
  return summoned;
}

function reduceHandMonsterLevelsForTurn(
  player: DragonPlayer,
  amount = 2,
): void {
  for (const card of player?.hand || []) {
    if (!card || card.cardKind !== "monster") continue;
    const currentLevel = card.level || 0;
    if (currentLevel <= 1) continue;
    card.originalLevel ??= currentLevel;
    card.level = Math.max(1, currentLevel - amount);
    card.simLevelReducedUntilEndTurn = true;
  }
}

function normalSummonFromHandIndex(
  state: DragonSimulationState,
  player: DragonPlayer,
  handIndex: number,
  action: Pick<DragonSimulationAction, "position"> = {},
): DragonCard | null {
  const card = player?.hand?.[handIndex];
  if (!card || !canUseNormalSummonForCard(player, card)) return null;
  const tributeInfo = (getTributeRequirementFor as (
    card: DragonCard,
    player: DragonPlayer,
  ) => AITributeRequirement)(card, player);
  if (!fieldHasTributeValue(player.field || [], tributeInfo.tributesNeeded, card)) {
    return null;
  }
  if (tributeInfo.tributesNeeded === 0 && (player.field || []).length >= 5) return null;

  if (tributeInfo.tributesNeeded > 0) {
    const tributeIndices = (selectBestTributes as (
      field: DragonCard[],
      tributesNeeded: number,
      cardToSummon?: DragonCard | null,
    ) => number[])(
      player.field,
      tributeInfo.tributesNeeded,
      card,
    )
      .sort((a, b) => b - a);
    const tributeCards = getTributeCardsFromIndices(player.field, tributeIndices);
    if (getTributeValueTotal(tributeCards, card) < tributeInfo.tributesNeeded) {
      return null;
    }
    if (
      tributeInfo.usingAlt === true &&
      tributeInfo.alt &&
      !tributeIndices.some((idx) =>
        tributeMatchesAltRequirement(player.field[idx], tributeInfo.alt),
      )
    ) {
      return null;
    }
    for (const index of tributeIndices) moveFieldIndexToGraveyard(player, index);
  }

  const liveIndex = player.hand.indexOf(card);
  if (liveIndex < 0) return null;
  const summonedCard = player.hand.splice(liveIndex, 1)[0];
  const summoned = {
    ...summonedCard,
    position: (action.position || "attack") as BattlePosition,
    isFacedown: false,
    hasAttacked: false,
  };
  player.field.push(summoned);
  player.summonCount = (player.summonCount || 0) + 1;
  recordNormalSummonForTurn(player, summoned);
  simulateDragonAfterSummonEffects(state, summoned, {
    method: tributeInfo.tributesNeeded > 0 ? "tribute" : "normal",
  });
  return summoned;
}

function simulateDragonAfterSummonEffects(
  state: DragonSimulationState,
  summoned: DragonCard,
  meta: DragonSummonMetadata = {},
): void {
  const player = state.bot;
  if (!summoned || summoned.isFacedown) return;

  if (summoned.name === "Armored Dragon" && meta.method === "normal") {
    simulateArmoredDragonSearch(state, player, summoned);
    recordSimulatedMaterialEffectActivation(state, player, summoned);
  }

  if (
    summoned.name === "Lunar Eclipse Dragon" &&
    (meta.method === "normal" || meta.method === "special")
  ) {
    simulateLunarEclipseOnSummon(state, player, summoned);
  }

  if (summoned.name === "Luminescent Dragon" && meta.method === "normal") {
    simulateLuminescentNormalRevive(state, player, summoned);
  }

  if (summoned.name === "Darkness Dragon") {
    const otherDragonIndices = (player.field || [])
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate !== summoned && isFaceupDragon(candidate))
      .map(({ index }) => index)
      .sort((a, b) => b - a);
    let destroyed = 0;
    for (const index of otherDragonIndices) {
      const sent = moveFieldIndexToGraveyard(player, index);
      if (sent) destroyed++;
    }
    if (destroyed > 0) {
      summoned.tempAtkBoost = (summoned.tempAtkBoost || 0) + destroyed * 300;
    }
  }

  if (summoned.name === "Grey Dragon" && meta.method === "special") {
    const target = (player.field || [])
      .filter((candidate) => candidate !== summoned && isFaceupDragon(candidate))
      .sort((a, b) => cardStrategicSimValue(b) - cardStrategicSimValue(a))[0];
    if (target) {
      target.tempAtkBoost = (target.tempAtkBoost || 0) + 500;
    }
  }
}

function simulateLunarEclipseOnSummon(
  state: DragonSimulationState,
  player: DragonPlayer,
  source: DragonCard,
): void {
  const effect = (source?.effects || []).find(
    (entry) => entry?.id === "lunar_eclipse_summon_search",
  );
  const searchAction: DragonSimulationAction = {
    type: "add_from_zone_to_hand",
    zone: "deck",
    filters: { cardKind: "monster", type: "Dragon", maxLevel: 4 },
    resultRef: "lunar_eclipse_added_dragon",
  };
  const deckEntries = (player.deck || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => isDragonMonster(candidate) && (candidate.level || 0) <= 4);
  if (deckEntries.length === 0 || (player.hand || []).length === 0) return;

  const discard = rankDiscardEntriesForSimulation(
    (player.hand || []).map((candidate, index) => ({ candidate, index })),
    state,
    source,
    effect,
  )[0];
  if (!discard) return;
  if (!useSimulatedOnce(state, player, "lunar_eclipse_summon_search")) return;

  const liveDiscardIndex = player.hand.indexOf(discard.candidate);
  if (liveDiscardIndex >= 0) discardHandCardToGraveyard(state, player, liveDiscardIndex);

  const selected = rankSearchEntriesForSimulation(
    deckEntries,
    state,
    searchAction,
    source,
    effect,
  )[0];
  if (selected) {
    const liveDeckIndex = player.deck.indexOf(selected.candidate);
    if (liveDeckIndex >= 0) player.hand.push(player.deck.splice(liveDeckIndex, 1)[0]);
  }

  if ((player.field || []).length < 5) {
    const solarZones = ["graveyard", "hand"] as const;
    for (const zoneName of solarZones) {
      const zone = player[zoneName] || [];
      const solarIndex = zone.findIndex((candidate) => candidate?.name === "Solar Eclipse Dragon");
      if (solarIndex < 0) continue;
      const solar = zone.splice(solarIndex, 1)[0];
      specialSummonToField(
        state,
        player,
        solar,
        { position: "attack", effectId: "lunar_eclipse_summon_search" },
        { method: "special" },
      );
      break;
    }
  }

  recordSimulatedMaterialEffectActivation(state, player, source);
}

function simulateLuminescentNormalRevive(
  state: DragonSimulationState,
  player: DragonPlayer,
  source: DragonCard,
): void {
  if ((player.field || []).length >= 5) return;
  const effect = (source?.effects || []).find(
    (entry) => entry?.id === "luminescent_dragon_normal_summon_revive",
  );
  const action: DragonSimulationAction = {
    type: "special_summon_from_zone",
    zone: "graveyard",
    filters: { cardKind: "monster", type: "Dragon" },
    maxLevel: 4,
    effectId: "luminescent_dragon_normal_summon_revive",
  };
  const target = rankRecruitEntriesForSimulation(
    (player.graveyard || [])
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => isDragonMonster(candidate) && (candidate.level || 0) <= 4),
    state,
    action,
    source,
    effect,
  )[0];
  if (!target) return;
  const liveIndex = player.graveyard.indexOf(target.candidate);
  if (liveIndex < 0) return;
  const revived = player.graveyard.splice(liveIndex, 1)[0];
  specialSummonToField(state, player, revived, action, { method: "special" });
  recordSimulatedMaterialEffectActivation(state, player, source);
}

function simulateArmoredDragonSearch(
  state: DragonSimulationState,
  player: DragonPlayer,
  source: DragonCard,
): void {
  const effect = (source?.effects || []).find(
    (entry) => entry?.id === "armored_dragon_search_on_normal",
  );
  const action: DragonSimulationAction = {
    type: "search_any",
    filters: { cardKind: "monster", type: "Dragon" },
    maxLevel: 4,
  };
  const entries = (player.deck || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate }) =>
        isDragonMonster(candidate) &&
        (candidate.level || 0) <= 4,
    );
  const target = rankSearchEntriesForSimulation(
    entries,
    state,
    action,
    source,
    effect,
  )[0];
  if (!target) return;
  const liveIndex = player.deck.indexOf(target.candidate);
  if (liveIndex >= 0) player.hand.push(player.deck.splice(liveIndex, 1)[0]);
}

function simulateBestConvergingSummon(
  state: DragonSimulationState,
  player: DragonPlayer,
  action: DragonSimulationAction,
): DragonCard | null {
  const candidates = (player.hand || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => {
      if (!isDragonMonster(candidate)) return false;
      if (!canUseNormalSummonForCard(player, candidate)) return false;
      const tributeInfo = (getTributeRequirementFor as (
        card: DragonCard,
        player: DragonPlayer,
      ) => AITributeRequirement)(candidate, player);
      if ((player.field || []).length < tributeInfo.tributesNeeded) return false;
      if (tributeInfo.tributesNeeded === 0 && (player.field || []).length >= 5) return false;
      return (
        CONVERGING_SUMMON_ORDER.includes(candidate.name as string) ||
        (candidate.level || 0) >= 5
      );
    })
    .sort((a, b) => {
      const score = (entry: DragonCandidateEntry) =>
        orderBonus(entry.candidate, CONVERGING_SUMMON_ORDER, 18) +
        cardStrategicSimValue(entry.candidate);
      return score(b) - score(a);
    });

  const selected = candidates[0];
  if (!selected) return null;
  return normalSummonFromHandIndex(state, player, selected.index, action);
}

function takeExtraDeckCard(
  player: DragonPlayer,
  name: string,
  fallback: DragonFallbackCard,
): DragonCard {
  const extraIndex = (player.extraDeck || []).findIndex(
    (candidate) => candidate?.name === name,
  );
  if (extraIndex >= 0) {
    return player.extraDeck.splice(extraIndex, 1)[0];
  }
  return { ...fallback } as DragonCard;
}

function shouldPreferTechVoidFusion(
  state: DragonSimulationState,
  techVoidMaterials: readonly DragonMaterialEntry[],
  radiantMaterials: readonly DragonMaterialEntry[],
): boolean {
  if ((techVoidMaterials || []).length !== 2) return false;
  const opponent = state.player || {};
  const canRadiant = (radiantMaterials || []).length === 3;
  const materialCost = (entries: readonly DragonMaterialEntry[]) =>
    (entries || []).reduce((sum, entry) => sum + materialValue(entry), 0);
  const techCost = materialCost(techVoidMaterials);
  const radiantCost = materialCost(radiantMaterials);
  const pressureNeed =
    (opponent.lp || 8000) <= 2500 ||
    (opponent.field || []).length >= 2 ||
    (opponent.field || []).some((card) => (card?.atk || 0) >= 2500);
  const muchCheaper = canRadiant && techCost + 3 < radiantCost;
  return pressureNeed || muchCheaper || !canRadiant;
}

function simulateTechVoidAfterSummon(
  state: DragonSimulationState,
  player: DragonPlayer,
  summoned: DragonCard,
): void {
  const context = buildSimBanishContext(state, player, summoned, {
    effectId: "tech_void_fusion_banish_buff",
  });
  const target = rankTechVoidBanishTargets(
    (player.graveyard || [])
      .map((candidate, index) => ({ candidate, index }))
      .filter(
        ({ candidate }) =>
          isDragonMonster(candidate) &&
          (candidate.level || 0) <= 4,
      ),
    context,
  )[0];

  if (!target) return;
  const liveIndex = player.graveyard.indexOf(target.candidate);
  if (liveIndex < 0) return;
  const banished = player.graveyard.splice(liveIndex, 1)[0];
  if (!player.banished) player.banished = [];
  player.banished.push(banished);
  const buff = Math.floor((banished.atk || 0) * 0.5);
  summoned.tempAtkBoost = (summoned.tempAtkBoost || 0) + buff;
}

function selectRadiantCosmicMaterials(
  entries: readonly DragonMaterialEntry[],
): DragonMaterialEntry[] {
  const dragons = (entries || []).filter((entry) => isDragonMonster(entry.card));
  if (dragons.length < 3) return [];

  const lightMaterials = dragons
    .filter((entry) => String(entry.card.attribute || "").toLowerCase() === "light")
    .sort((a, b) => materialValue(a) - materialValue(b));
  if (lightMaterials.length === 0) return [];

  const selected = [lightMaterials[0]];
  const remaining = dragons
    .filter((entry) => entry !== selected[0])
    .sort((a, b) => materialValue(a) - materialValue(b));
  selected.push(...remaining.slice(0, 2));

  return selected.length === 3 ? selected : [];
}

function selectTechVoidMaterials(
  entries: readonly DragonMaterialEntry[],
): DragonMaterialEntry[] {
  const voltaic = (entries || [])
    .filter((entry) => entry.card?.name === "Voltaic Dragon")
    .sort((a, b) => materialValue(a) - materialValue(b))[0];
  if (!voltaic) return [];

  const lv5Dragon = (entries || [])
    .filter(
      (entry) =>
        entry !== voltaic &&
        isDragonMonster(entry.card) &&
        entry.card.name !== "Voltaic Dragon" &&
        (entry.card.level || 0) >= 5,
    )
    .sort((a, b) => materialValue(a) - materialValue(b))[0];

  return lv5Dragon ? [voltaic, lv5Dragon] : [];
}

function moveFusionMaterialsToGY(
  player: DragonPlayer,
  entries: readonly DragonMaterialEntry[],
): void {
  const sortedEntries = [...(entries || [])].sort((a, b) => {
    if (a.zone !== b.zone) return a.zone === "field" ? -1 : 1;
    return b.index - a.index;
  });

  for (const entry of sortedEntries) {
    const zoneCards = player?.[entry.zone] || [];
    const card = zoneCards[entry.index];
    if (!card) continue;
    zoneCards.splice(entry.index, 1);
    putSimulatedCard(player, card, "graveyard");
  }
}

function simulateRadiantCosmicRefund(player: DragonPlayer): void {
  if ((player.graveyard || []).length > 0) {
    const recycleIdx = pickWorstDeckRefund(player.graveyard);
    const recycled = player.graveyard.splice(recycleIdx, 1)[0];
    if (recycled) {
      putSimulatedCard(player, recycled, "deck");
    }
  }

  if ((player.deck || []).length > 0) {
    player.hand.push(player.deck.shift()!);
  }
}

function pickWorstDeckRefund(graveyard: readonly DragonCard[]): number {
  let worstIdx = 0;
  let worstScore = Infinity;

  for (let i = 0; i < graveyard.length; i++) {
    const card = graveyard[i];
    const knowledge = (CARD_KNOWLEDGE as Partial<
      Record<string, DragonCardKnowledge>
    >)[card.name as string] || {};
    let score = knowledge.value || 0;

    if (isDragonMonster(card)) score += 6;
    if (isExtremeDragon(card)) score += 8;
    if (card.name === "Hellkite Roar") score += 10;
    if (card.name === "Radiant Cosmic Dragon") score += 12;

    if (score < worstScore) {
      worstScore = score;
      worstIdx = i;
    }
  }

  return worstIdx;
}

/**
 * Simulates hand ignition effects for Dragon monsters.
 */
function simulateDragonHandIgnition(
  state: DragonSimulationState,
  card: DragonCard,
  action: DragonSimulationAction,
): void {
  const player = state.bot;

  if (card.name === "Solar Eclipse Dragon") {
    if ((player.field || []).length >= 5) return;
    const effect = (card.effects || []).find(
      (entry) => entry?.id === "solar_eclipse_discard_summon_lunar",
    );
    const recruitAction: DragonSimulationAction = {
      type: "special_summon_from_zone",
      zone: ["hand", "deck"],
      filters: { name: "Lunar Eclipse Dragon" },
      effectId: "solar_eclipse_discard_summon_lunar",
    };
    const lunarEntries: DragonZonedCandidateEntry[] = [
      ...(player.hand || []).map((candidate, index) => ({
        candidate,
        index,
        zoneName: "hand" as const,
      })),
      ...(player.deck || []).map((candidate, index) => ({
        candidate,
        index,
        zoneName: "deck" as const,
      })),
    ].filter(({ candidate }) => candidate?.name === "Lunar Eclipse Dragon");
    const selected = rankRecruitEntriesForSimulation(
      lunarEntries,
      state,
      recruitAction,
      card,
      effect,
    )[0];
    if (!selected) return;

    const solarIndex = player.hand.indexOf(card);
    if (solarIndex < 0) return;
    if (!useSimulatedOnce(state, player, getSimulatedEffectOnceKey(effect))) {
      return;
    }
    discardHandCardToGraveyard(state, player, solarIndex);

    const sourceZone = (player as DragonZoneStorage)[selected.zoneName] || [];
    const liveIndex = sourceZone.indexOf(selected.candidate);
    if (liveIndex < 0) return;
    const lunar = sourceZone.splice(liveIndex, 1)[0];
    const summoned = specialSummonToField(state, player, lunar, recruitAction, {
      method: "special",
      skipAfterSummon: true,
    });
    if (summoned) {
      reduceHandMonsterLevelsForTurn(player, 2);
      simulateDragonAfterSummonEffects(state, summoned, { method: "special" });
      recordSimulatedMaterialEffectActivation(state, player, card);
    }
    return;
  }

  if (card.name === "Luminous Dragon") {
    if (player.field.length === 0 && player.field.length < 5) {
      player.hand.splice(action.index!, 1);
      const summoned = specialSummonToField(state, player, card, action, {
        method: "special",
      });
      if (summoned) recordSimulatedMaterialEffectActivation(state, player, summoned);
    }
    return;
  }

  if (card.name === "Voltaic Dragon") {
    // SS if control Dragon — just place it on field
    if (player.field.some(isFaceupDragon) && player.field.length < 5) {
      player.hand.splice(action.index!, 1);
      const summoned = specialSummonToField(state, player, card, action, {
        method: "special",
      });
      if (summoned) recordSimulatedMaterialEffectActivation(state, player, summoned);
    }
    return;
  }

  if (card.name === "Hellkite Dragon") {
    // Send field Dragon to GY → SS Hellkite from hand
    const cost = selectFieldDragonCosts(player, 1, {
      preserveNames: ["Luminous Dragon", "Purified Crystal Dragon"],
    })[0];
    if (cost && player.field.length < 5) {
      moveFieldIndexToGraveyard(player, cost.index);
      const liveIndex = player.hand.indexOf(card);
      if (liveIndex >= 0) {
        player.hand.splice(liveIndex, 1);
        const summoned = specialSummonToField(state, player, card, action, {
          method: "special",
        });
        if (summoned) recordSimulatedMaterialEffectActivation(state, player, summoned);
      }
    }
    return;
  }

  if (card.name === "Stelya, Dragon Tamer" && action.effectId === "stelya_discard_search_dragon") {
    const effect = (card.effects || []).find(
      (entry) => entry?.id === "stelya_discard_search_dragon",
    );
    if (!effect) return;
    const otherDiscard = rankDiscardEntriesForSimulation(
      (player.hand || [])
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => candidate !== card),
      state,
      card,
      effect,
    )[0];
    if (!otherDiscard) return;
    const selfIndex = player.hand.indexOf(card);
    if (selfIndex < 0) return;

    const searchAction: DragonSimulationAction = {
      type: "add_from_zone_to_hand",
      zone: "deck",
      filters: { cardKind: "monster", type: "Dragon" },
      minLevel: 5,
      effectId: "stelya_discard_search_dragon",
    };
    const selected = rankSearchEntriesForSimulation(
      (player.deck || [])
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => isDragonMonster(candidate) && (candidate.level || 0) >= 5),
      state,
      searchAction,
      card,
      effect,
    )[0];
    if (!selected) return;
    if (!useSimulatedOnce(state, player, getSimulatedEffectOnceKey(effect))) return;

    discardHandCardToGraveyard(state, player, selfIndex);
    const otherIndex = player.hand.indexOf(otherDiscard.candidate);
    if (otherIndex >= 0) discardHandCardToGraveyard(state, player, otherIndex);
    const liveDeckIndex = player.deck.indexOf(selected.candidate);
    if (liveDeckIndex >= 0) player.hand.push(player.deck.splice(liveDeckIndex, 1)[0]);
    recordSimulatedMaterialEffectActivation(state, player, card);
    return;
  }

  if (card.name === "Stelya, Dragon Tamer") {
    const effect = (card.effects || []).find(
      (entry) =>
        entry?.id === action.effectId ||
        entry?.id === "stelya_hand_banish_dragon_summon",
    );
    const cost = selectStelyaFieldBanishCost(state, player, card, action);
    const liveIndex = player.hand.indexOf(card);
    if (
      effect &&
      cost &&
      liveIndex >= 0 &&
      useSimulatedOnce(state, player, getSimulatedEffectOnceKey(effect))
    ) {
      const liveCostIndex = player.field.indexOf(cost.candidate);
      if (liveCostIndex >= 0) {
        const banished = player.field.splice(liveCostIndex, 1)[0];
        if (!player.banished) player.banished = [];
        if (banished) player.banished.push(banished);
      }
      player.hand.splice(liveIndex, 1);
      const summoned = specialSummonToField(state, player, card, action, {
        method: "special",
      });
      if (summoned) recordSimulatedMaterialEffectActivation(state, player, summoned);
    }
    return;
  }

  if (card.name === "Black Bull Dragon") {
    // Discard 2 Dragons → SS Black Bull (can't attack this turn)
    const toDiscard = selectHandDragonDiscardCosts(state, player, card, 2);
    if (toDiscard.length >= 2 && player.field.length < 5) {
      const discardIndices = toDiscard.map(({ index }) => index).sort((a, b) => b - a);
      for (const index of discardIndices) {
        discardHandCardToGraveyard(state, player, index);
      }
      const liveIndex = player.hand.indexOf(card);
      if (liveIndex >= 0) {
        player.hand.splice(liveIndex, 1);
        const summoned = specialSummonToField(state, player, card, action, {
          method: "special",
          cannotAttackThisTurn: true,
        });
        if (summoned) {
          summoned.simMultiAttackPressure = true;
          recordSimulatedMaterialEffectActivation(state, player, summoned);
        }
      }
    }
    return;
  }

  if (card.name === "Purified Crystal Dragon") {
    // Banish 3 GY Dragons → SS
    const purifiedDecision = shouldUsePurifiedBanishSummon(
      buildSimBanishContext(state, player, card, action),
    );
    if (!purifiedDecision.ok) return;
    const gyCost = selectGraveyardDragonCosts(state, player, 3, card, action);
    if (gyCost.length >= 3 && player.field.length < 5) {
      const costIndices = gyCost.map(({ index }) => index).sort((a, b) => b - a);
      for (const index of costIndices) {
        const banished = player.graveyard.splice(index, 1)[0];
        if (!player.banished) player.banished = [];
        if (banished) player.banished.push(banished);
      }
      const liveIndex = player.hand.indexOf(card);
      if (liveIndex >= 0) {
        player.hand.splice(liveIndex, 1);
        const summoned = specialSummonToField(state, player, card, action, {
          method: "special",
        });
        if (summoned) recordSimulatedMaterialEffectActivation(state, player, summoned);
      }
    }
    return;
  }
}

function simulateDragonSpellTrapIgnition(
  state: DragonSimulationState,
  card: DragonCard,
  action: DragonSimulationAction,
  zoneIndex: number,
): void {
  const player = state.bot;
  if (card.name !== "Extreme Dragon Awakening") return;

  const fieldDragonEntries = selectFieldDragonCosts(player, 2, {
    preserveNames: ["Luminous Dragon", "Purified Crystal Dragon", "Radiant Cosmic Dragon"],
  });
  if (fieldDragonEntries.length < 2) return;

  const hasExtremeFaceup = (player.field || []).some(isExtremeDragon);
  const targetEntries = (player.hand || [])
    .map((candidate, index) => ({ candidate, index }))
    .filter(
      ({ candidate }) =>
        isDragonMonster(candidate) &&
        (candidate.level || 0) >= 8 &&
        AWAKENING_TARGET_ORDER.includes(candidate.name as string) &&
        (!hasExtremeFaceup || !isExtremeDragon(candidate)),
    );
  const bossTarget = (selectBestDragonBoss as (
    candidates: DragonCard[],
    context: DragonBossSelectionContext,
  ) => DragonCard | null)(
    targetEntries.map(({ candidate }) => candidate),
    {
      player,
      bot: player,
      opponent: state.player,
      game: state,
      routeKind: "awakening",
      fieldCostCount: 2,
      isSimulatedState: true,
    },
  );
  const handTargetEntry = bossTarget
    ? targetEntries.find(({ candidate }) => candidate === bossTarget)
    : targetEntries.sort((a, b) => {
      const score = (entry: DragonCandidateEntry) =>
        orderBonus(entry.candidate, AWAKENING_TARGET_ORDER) +
        cardStrategicSimValue(entry.candidate);
      return score(b) - score(a);
    })[0];
  if (!handTargetEntry) return;

  const costIndices = fieldDragonEntries.slice(0, 2).map(({ index }) => index).sort((a, b) => b - a);
  for (const index of costIndices) {
    moveFieldIndexToGraveyard(player, index);
  }

  const targetIndex = player.hand.indexOf(handTargetEntry.candidate);
  if (targetIndex >= 0 && player.field.length < 5) {
    const summoned = player.hand.splice(targetIndex, 1)[0];
    specialSummonToField(state, player, summoned, action, {
      method: "special",
    });
  }
}

function simulateDragonFieldSpellEffect(
  state: DragonSimulationState,
  card: DragonCard,
  action: DragonSimulationAction,
): void {
  const player = state.bot;
  if (card.name !== "Jagged Peak of the Dragons") return;
  if (((card.counters as DragonCounterObject)?.dragon_peak || 0) < 5) return;
  if ((player.field || []).length >= 5) return;

  player.fieldSpell = null;
  putSimulatedCard(player, card, "graveyard");

  const zones = ["hand", "deck", "graveyard"] as const;
  const candidates: DragonFieldSpellCandidateEntry[] = [];
  for (const zone of zones) {
    ((player as DragonZoneStorage)[zone] || []).forEach((candidate, index) => {
      if (isDragonMonster(candidate)) candidates.push({ candidate, zone, index });
    });
  }
  candidates.sort((a, b) => cardStrategicSimValue(b.candidate) - cardStrategicSimValue(a.candidate));
  const selected = candidates[0];
  if (!selected) return;
  const sourceZone = player[selected.zone] || [];
  const liveIndex = sourceZone.indexOf(selected.candidate);
  if (liveIndex < 0) return;
  const summoned = sourceZone.splice(liveIndex, 1)[0];
  specialSummonToField(state, player, summoned, action, {
    method: "special",
  });
}

function simulateDragonFieldMonsterEffect(
  state: DragonSimulationState,
  card: DragonCard,
  action: DragonSimulationAction,
  fieldIndex: number,
): void {
  const player = state.bot;
  const opponent = state.player;

  if (card.name === "Abyssal Serpent Dragon") {
    const target = rankSimThreats(opponent.field || [])[0];
    if (!target) return;
    player.field.splice(fieldIndex, 1);
    putSimulatedCard(player, card, "graveyard");
    const targetIndex = opponent.field.indexOf(target);
    if (targetIndex >= 0) {
      opponent.field.splice(targetIndex, 1);
      putSimulatedCard(opponent, target, "graveyard");
    }
    recordSimulatedMaterialEffectActivation(state, player, card);
    return;
  }

  if (card.name === "Darkness Dragon") {
    if ((player.hand || []).length > 0) {
      const discardIdx = pickWorstDiscard(player.hand, {
        state,
        player,
        source: card,
      });
      discardHandCardToGraveyard(state, player, discardIdx);
    }
    const target = rankSimThreats(opponent.field || [])[0];
    if (target) target.effectsNegated = true;
    recordSimulatedMaterialEffectActivation(state, player, card);
    return;
  }

  if (card.name === "Majestic Silver Dragon") {
    const target = rankSimThreats(opponent.field || [])[0];
    if (target) {
      target.position = target.position === "defense" ? "attack" : "defense";
      recordSimulatedMaterialEffectActivation(state, player, card);
    }
    return;
  }

  if (card.name === "Purified Crystal Dragon") {
    const target = (player.field || [])
      .filter((candidate) => candidate !== card && isFaceupDragon(candidate))
      .sort((a, b) => cardStrategicSimValue(b) - cardStrategicSimValue(a))[0];
    if (!target) return;
    target.simEffectDestructionProtected = true;
    target.simProtectedBy = "Purified Crystal Dragon";
    recordSimulatedMaterialEffectActivation(state, player, card);
    return;
  }

  if (card.name === "Rainbow Cosmic Dragon") {
    const target = (player.field || [])
      .filter(isFaceupDragon)
      .sort((a, b) => cardStrategicSimValue(b) - cardStrategicSimValue(a))[0];
    if (!target) return;
    target.simBattleDestructionProtected = true;
    target.simEffectDestructionProtected = true;
    target.simProtectedUntilNextTurn = true;
    target.simProtectedBy = "Rainbow Cosmic Dragon";
    recordSimulatedMaterialEffectActivation(state, player, card);
    return;
  }

  if (card.name === "Hellkite Dragon") {
    const gyTarget = (player.graveyard || [])
      .filter((candidate) => isDragonMonster(candidate) && (candidate.level || 0) <= 7)
      .sort((a, b) => cardStrategicSimValue(b) - cardStrategicSimValue(a))[0];
    if (!gyTarget) return;
    player.field.splice(fieldIndex, 1);
    putSimulatedCard(player, card, "graveyard");
    const gyIndex = player.graveyard.indexOf(gyTarget);
    if (gyIndex >= 0 && player.field.length < 5) {
      const summoned = player.graveyard.splice(gyIndex, 1)[0];
      specialSummonToField(state, player, summoned, action, {
        method: "special",
      });
      recordSimulatedMaterialEffectActivation(state, player, card);
    }
    return;
  }

  if (card.name === "Volcanic Extreme Dragon") {
    if (!useSimulatedOnce(state, player, "volcanic_extreme_dragon_banish_burn")) return;
    const totalGy = (player.graveyard || []).length + (opponent.graveyard || []).length;
    if (totalGy <= 0) return;
    opponent.lp -= totalGy * 100;
    player.banished = [...(player.banished || []), ...(player.graveyard || [])];
    opponent.banished = [...(opponent.banished || []), ...(opponent.graveyard || [])];
    player.graveyard = [];
    opponent.graveyard = [];
    recordSimulatedMaterialEffectActivation(state, player, card);
  }
}

function simulateDragonGraveyardSpellEffect(
  state: DragonSimulationState,
  card: DragonCard,
  action: DragonSimulationAction,
  graveyardIndex: number,
): void {
  const player = state.bot;
  if (card.name !== "Hellkite Roar") return;
  const liveIndex = Number.isInteger(graveyardIndex)
    ? graveyardIndex
    : player.graveyard.indexOf(card);
  if (liveIndex >= 0) {
    const banished = player.graveyard.splice(liveIndex, 1)[0];
    putSimulatedCard(player, banished, "banished");
  }
  const deckIndex = (player.deck || []).findIndex(
    (candidate) => candidate?.name === "Jagged Peak of the Dragons",
  );
  if (deckIndex >= 0) {
    player.hand.push(player.deck.splice(deckIndex, 1)[0]);
  }
}

function simulateDragonGraveyardMonsterEffect(
  state: DragonSimulationState,
  card: DragonCard,
  action: DragonSimulationAction,
): void {
  const player = state.bot;
  const opponent = state.player;
  if (card.name === "Rainbow Cosmic Dragon" && !hasRainbowGyFollowUp(player)) {
    return;
  }
  const requestedEffectId = action?.effectId || null;
  const effect = (card.effects || []).find(
    (entry) =>
      entry &&
      entry.timing === "ignition" &&
      entry.activationZones?.includes("graveyard") &&
      (!requestedEffectId || entry.id === requestedEffectId),
  );
  if (!effect) return;
  const effectUsageKey = getSimulatedEffectOnceKey(effect);
  if (
    effectUsageKey &&
    !canUseSimulatedOnce(state, player, effectUsageKey)
  ) {
    return;
  }
  if (card.name === "Stelya, Dragon Tamer") {
    const stelyaDecision = shouldUseStelyaBanishSummon(
      buildSimBanishContext(state, player, card, action, {
        effectId: effect.id,
      }),
    );
    if (!stelyaDecision.ok) return;
  }
  const luminescentDebuffPlan =
    effect.id === "luminescent_dragon_banish_debuff"
      ? (getLuminescentBattleDebuffPlan as (
          context: {
            bot: DragonPlayer;
            player: DragonPlayer;
            opponent: DragonPlayer;
          },
        ) => DragonLuminescentDebuffPlan)({ bot: player, player, opponent })
      : null;
  if (effect.id === "luminescent_dragon_banish_debuff" && !luminescentDebuffPlan?.ok) {
    return;
  }

  const targetSelections: DragonTargetSelectionMap = {};
  let resolvedAnyAction = false;
  for (const target of effect.targets || []) {
    const owner = target.owner === "opponent" ? opponent : player;
    const zoneName = target.zone || "field";
    const zone =
      zoneName === "fieldSpell"
        ? owner?.fieldSpell
          ? [owner.fieldSpell]
          : []
        : (owner as DragonZoneStorage)?.[zoneName as DragonZoneStorageKey] || [];
    let candidates: DragonTargetSelection[] = (zone || [])
      .map((candidate, index) => ({ candidate, index, owner, zoneName }))
      .filter(({ candidate }) => matchesEffectTarget(candidate, target));
    if (target.excludeSelf) {
      candidates = candidates.filter(({ candidate }) => candidate !== card);
    }
    if (target.excludeCardName) {
      candidates = candidates.filter(({ candidate }) => candidate?.name !== target.excludeCardName);
    }
    if (card.name === "Boneflame Dragon" && target.id === "boneflame_cost_target") {
      candidates = candidates.filter(({ candidate, owner }) =>
        isValidBoneflameCost(card, candidate, owner),
      );
    }
    if (target.id === "luminescent_debuff_target" && luminescentDebuffPlan?.target) {
      candidates = candidates.filter(({ candidate }) => {
        const preferred = luminescentDebuffPlan.preferredNames || [];
        return (
          candidate === luminescentDebuffPlan.target ||
          preferred.includes(candidate?.name as string)
        );
      });
    }
    if (candidates.length < (target.count?.min ?? 1)) return;

    if (
      target.id === "stelya_hand_banish_cost" ||
      target.id === "stelya_graveyard_banish_cost"
    ) {
      candidates = rankDragonFieldBanishCosts(
        candidates,
        buildSimBanishContext(state, player, card, action, {
          effectId: effect.id,
        }),
      );
    } else if (
      target.id === "solar_eclipse_gy_revive_target" ||
      target.id === "lunar_eclipse_deck_summon_target"
    ) {
      candidates = rankRecruitEntriesForSimulation(
        candidates,
        state,
        {
          type: "special_summon_from_zone",
          zone: target.zone,
          targetRef: target.id,
          effectId: effect.id,
        },
        card,
        effect,
      );
      if (candidates.length === 0) return;
    } else if (target.intent === "cost" && zoneName === "hand") {
      candidates = rankDiscardEntriesForSimulation(candidates, state, card, effect);
    } else {
      candidates.sort((a, b) => {
        if (target.id === "luminescent_debuff_target") {
          const preferred = luminescentDebuffPlan?.preferredNames || [];
          const score = (entry: DragonTargetSelection) => {
            const order = preferred.indexOf(entry.candidate?.name as string);
            return (
              (entry.candidate === luminescentDebuffPlan?.target ? 10000 : 0) +
              (order >= 0 ? 1000 - order * 20 : 0) +
              Math.max(
                Number(entry.candidate?.atk || 0) + Number(entry.candidate?.tempAtkBoost || 0),
                Number(entry.candidate?.def || 0) + Number(entry.candidate?.tempDefBoost || 0),
              )
            );
          };
          return score(b) - score(a);
        }
        if (card.name === "Boneflame Dragon" && target.id === "boneflame_cost_target") {
          return (
            getEffectiveAtk(a.candidate) - getEffectiveAtk(b.candidate) ||
            cardStrategicSimValue(a.candidate) -
              cardStrategicSimValue(b.candidate)
          );
        }
        if (target.id === "rainbow_cosmic_extreme_send_targets") {
          const score = (entry: DragonTargetSelection) =>
            orderBonus(entry.candidate, EXTREME_GY_SEND_ORDER, 30) +
            cardStrategicSimValue(entry.candidate);
          return score(b) - score(a);
        }
        const score = (entry: DragonTargetSelection) => {
          let value = cardStrategicSimValue(entry.candidate);
          if (isExtremeDragon(entry.candidate)) value += 100000;
          return value;
        };
        return score(a) - score(b);
      });
    }

    targetSelections[target.id] = candidates.slice(0, target.count?.max || 1);
  }

  const movesSourceAsCost = (effect.activationCosts || []).some(
    (costAction) =>
      (costAction as DragonSimulationAction)?.targetRef === "self" &&
      (costAction.type === "move" || costAction.type === "banish"),
  );
  const dynamicSummonPlans = new Map<CardAction, DragonTargetSelection[]>();
  for (const effectAction of effect.actions || []) {
    if (
      effectAction?.type !== "special_summon_from_zone" ||
      effectAction.targetRef ||
      effectAction.requireSource === true
    ) {
      continue;
    }
    const candidates = collectSimulatedActionZoneEntries(
      player,
      effectAction,
    ).filter(
      ({ candidate }) =>
        candidate !== (movesSourceAsCost ? card : null) &&
        matchesActionFilters(candidate, effectAction),
    );
    const minRequired = Number(
      (effectAction.count as { readonly min?: number } | undefined)?.min ?? 1,
    );
    if (candidates.length < Math.max(1, minRequired)) return;
    const ranked = rankRecruitEntriesForSimulation(
      candidates,
      state,
      {
        ...effectAction,
        effectId: effect.id,
      } as DragonSimulationAction,
      card,
      effect,
    );
    if (ranked.length < Math.max(1, minRequired)) return;
    dynamicSummonPlans.set(effectAction, ranked);
  }

  if (
    effectUsageKey &&
    !useSimulatedOnce(state, player, effectUsageKey)
  ) {
    return;
  }

  for (const costAction of effect.activationCosts || []) {
    if (costAction?.type !== "move" && costAction?.type !== "banish") {
      continue;
    }
    if (costAction.targetRef === "self") {
      const fromZone = costAction.fromZone || "graveyard";
      const toZone =
        costAction.type === "banish"
          ? "banished"
          : costAction.to || "graveyard";
      moveSimulatedCard(player, card, fromZone, toZone, state);
      continue;
    }
    for (const selection of targetSelections[costAction.targetRef as string] || []) {
      moveSimulatedCard(
        selection.owner || player,
        selection.candidate,
        selection.zoneName || costAction.fromZone || "graveyard",
        costAction.type === "banish"
          ? "banished"
          : costAction.to || "graveyard",
        state,
      );
    }
  }

  for (const effectAction of effect.actions || []) {
    if (effectAction.type === "move" && effectAction.targetRef) {
      const selections = targetSelections[effectAction.targetRef] || [];
      for (const selection of selections) {
        moveSimulatedCard(
          selection.owner,
          selection.candidate,
          selection.zoneName,
          effectAction.to || "graveyard",
          state,
        );
        resolvedAnyAction = true;
      }
      continue;
    }

    if (effectAction.type === "banish" && effectAction.targetRef === "self") {
      const fromZone = effectAction.fromZone || "graveyard";
      const sourceZone =
        (player as DragonZoneStorage)[fromZone as DragonZoneStorageKey] || [];
      const sourceIndex = sourceZone.indexOf(card);
      if (sourceIndex >= 0) {
        const banished = sourceZone.splice(sourceIndex, 1)[0];
        if (!player.banished) player.banished = [];
        player.banished.push(banished);
        resolvedAnyAction = true;
      }
      continue;
    }

    if (effectAction.type === "add_from_zone_to_hand") {
      const zoneName = effectAction.zone || "deck";
      const sourceZone =
        (player as DragonZoneStorage)[zoneName as DragonZoneStorageKey] || [];
      const candidates = sourceZone
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => matchesActionFilters(candidate, effectAction));
      if (effectAction.requireSource === true) {
        const sourceIndex = sourceZone.indexOf(card);
        if (sourceIndex >= 0 && matchesActionFilters(card, effectAction)) {
          candidates.unshift({ candidate: card, index: sourceIndex });
        }
      }
      if (candidates.length === 0) continue;
      const selected = rankSearchEntriesForSimulation(
        candidates,
        state,
        effectAction,
        card,
        effect,
      )[0];
      const liveIndex = sourceZone.indexOf(selected.candidate);
      if (liveIndex >= 0) {
        player.hand.push(sourceZone.splice(liveIndex, 1)[0]);
        resolvedAnyAction = true;
      }
      continue;
    }

    if (effectAction.type === "special_summon_from_zone" && effectAction.targetRef) {
      const selections = targetSelections[effectAction.targetRef] || [];
      for (const selection of selections) {
        if ((player.field || []).length >= 5) break;
        const owner = selection.owner || player;
        const zoneName = selection.zoneName || effectAction.zone || "graveyard";
        const sourceZone =
          (owner as DragonZoneStorage)[zoneName as DragonZoneStorageKey] || [];
        const liveIndex = sourceZone.indexOf(selection.candidate);
        if (liveIndex < 0) continue;
        const summonedCard = sourceZone.splice(liveIndex, 1)[0];
        const summoned = specialSummonToField(
          state,
          player,
          summonedCard,
          {
            ...effectAction,
            effectId: effect.id,
          },
          { method: "special" },
        );
        if (summoned) resolvedAnyAction = true;
      }
      continue;
    }

    if (
      effectAction.type === "special_summon_from_zone" &&
      !effectAction.targetRef &&
      effectAction.requireSource !== true
    ) {
      if ((player.field || []).length >= 5) continue;
      const ranked = dynamicSummonPlans.get(effectAction) || [];
      const maxSummons = Math.min(
        Number(
          (effectAction.count as { readonly max?: number } | undefined)?.max ?? 1,
        ),
        5 - (player.field?.length || 0),
      );
      for (const selection of ranked.slice(0, maxSummons)) {
        const sourceZone =
          (player as DragonZoneStorage)[
            selection.zoneName as DragonZoneStorageKey
          ] || [];
        const liveIndex = sourceZone.indexOf(selection.candidate);
        if (liveIndex < 0) continue;
        const summonedCard = sourceZone.splice(liveIndex, 1)[0];
        const summoned = specialSummonToField(
          state,
          player,
          summonedCard,
          {
            ...effectAction,
            effectId: effect.id,
          },
          { method: "special" },
        );
        if (summoned) resolvedAnyAction = true;
      }
      continue;
    }

    if (
      effectAction.type === "special_summon_from_zone" &&
      effectAction.zone === "graveyard" &&
      effectAction.requireSource === true
    ) {
      const sourceIndex = (player.graveyard || []).indexOf(card);
      if (sourceIndex < 0 || (player.field?.length || 0) >= 5) continue;
      player.graveyard.splice(sourceIndex, 1);
      const summoned = {
        ...card,
        position: (action.position || "attack") as BattlePosition,
        isFacedown: false,
        hasAttacked: false,
        cannotAttackThisTurn: false,
      };
      applySimulatedPassiveBuffs(summoned, player);
      player.field.push(summoned);
      simulateDragonAfterSummonEffects(state, summoned, { method: "special" });
      resolvedAnyAction = true;
    }
  }

  if (resolvedAnyAction) {
    recordSimulatedMaterialEffectActivation(state, player, card);
  }
}

function simulateDragonAscension(
  state: DragonSimulationState,
  action: DragonSimulationAction,
): void {
  const player = state.bot;
  if (!player) return;

  const materialIndex = Number.isInteger(action.materialIndex)
    ? action.materialIndex
    : (player.field || []).findIndex(
        (candidate) =>
          candidate &&
          candidate.cardKind === "monster" &&
          !candidate.isFacedown &&
          (
            candidate.id === action.materialId ||
            ascensionMaterialMatches(
              action.ascensionCard as (DragonCard & GameCard) | null | undefined,
              candidate as DragonCard & GameCard,
            )
          ),
      );
  const material = player.field?.[materialIndex!];
  if (!material || material.isFacedown) return;

  const extraIndex = (player.extraDeck || []).findIndex(
    (candidate) =>
      candidate &&
      candidate.monsterType === "ascension" &&
      (
        candidate.id === action.ascensionCard?.id ||
        candidate.name === action.cardName ||
        candidate.name === action.ascensionCard?.name
      ),
  );
  const ascensionCard =
    extraIndex >= 0 ? player.extraDeck[extraIndex] : action.ascensionCard;
  if (!ascensionCard || ascensionCard.monsterType !== "ascension") return;
  if (
    !ascensionMaterialMatches(
      ascensionCard as DragonCard & GameCard,
      material as DragonCard & GameCard,
    )
  ) return;

  const requirements = ascensionCard.ascension?.requirements || [];
  const requirementsMet = requirements.every((requirement) => {
    if (requirement?.type !== "material_effect_activations") return true;
    const required = Number(requirement.count || requirement.min || 0);
    return getMaterialEffectActivationCount(state, player, material.id) >= required;
  });
  if (!requirementsMet) return;

  player.field.splice(materialIndex!, 1);
  putSimulatedCard(player, material, "graveyard");
  if (extraIndex >= 0) player.extraDeck.splice(extraIndex, 1);
  const summoned = specialSummonToField(
    state,
    player,
    ascensionCard as DragonCard,
    action,
    {
    method: "ascension",
    position: action.position || ascensionCard.ascension?.position || "attack",
    },
  );
  if (summoned?.id === 267 || summoned?.name === "Rainbow Cosmic Dragon") {
    summoned.simBattleDestructionProtected = true;
  }
}

function matchesEffectTarget(
  card: DragonCard | null | undefined,
  target: EffectTarget,
): boolean {
  if (!card) return false;
  if (target.cardKind && card.cardKind !== target.cardKind) return false;
  if (target.type && card.type !== target.type) return false;
  if (target.name && card.name !== target.name) return false;
  if (target.filters?.type && card.type !== target.filters.type) return false;
  if (target.filters?.name && card.name !== target.filters.name) return false;
  if (target.filters?.cardKind && card.cardKind !== target.filters.cardKind) return false;
  if (target.cardName && card.name !== target.cardName) return false;
  if (Number.isFinite(target.minLevel) && (card.level || 0) < target.minLevel!) return false;
  if (Number.isFinite(target.maxLevel) && (card.level || 0) > target.maxLevel!) return false;
  if (Number.isFinite(target.filters?.minLevel) && (card.level || 0) < target.filters!.minLevel!) return false;
  if (Number.isFinite(target.filters?.maxLevel) && (card.level || 0) > target.filters!.maxLevel!) return false;
  if (target.requireFaceup && card.isFacedown) return false;
  if (target.archetype) {
    const archetypes = Array.isArray(card.archetypes)
      ? card.archetypes
      : card.archetype
        ? [card.archetype]
        : [];
    if (!archetypes.includes(target.archetype)) return false;
  }
  return true;
}

function matchesActionFilters(
  card: DragonCard | null | undefined,
  action: DragonSimulationAction | CardAction,
): boolean {
  if (!card) return false;
  const filters = (action as DragonSimulationAction).filters || {};
  if ((action as DragonSimulationAction).cardKind && card.cardKind !== (action as DragonSimulationAction).cardKind) return false;
  if (filters.cardKind && card.cardKind !== filters.cardKind) return false;
  if (filters.name && card.name !== filters.name) return false;
  if (filters.type && card.type !== filters.type) return false;
  if (Number.isFinite((action as DragonSimulationAction).minLevel) && (card.level || 0) < (action as DragonSimulationAction).minLevel!) return false;
  if (Number.isFinite((action as DragonSimulationAction).maxLevel) && (card.level || 0) > (action as DragonSimulationAction).maxLevel!) return false;
  if (Number.isFinite(filters.minLevel) && (card.level || 0) < filters.minLevel!) return false;
  if (Number.isFinite(filters.maxLevel) && (card.level || 0) > filters.maxLevel!) return false;
  return true;
}

function collectSimulatedActionZoneEntries(
  player: DragonPlayer,
  action: DragonSimulationAction | CardAction,
): DragonTargetSelection[] {
  const zoneSpec =
    (action as DragonSimulationAction)?.zone ||
    (action as DragonSimulationAction)?.sourceZone ||
    "deck";
  const zoneNames: readonly ZoneInput[] = Array.isArray(zoneSpec) ? zoneSpec : [zoneSpec as ZoneInput];
  return zoneNames.flatMap((zoneName) =>
    ((player as DragonZoneStorage)?.[zoneName as DragonZoneStorageKey] || []).map((candidate, index) => ({
      candidate,
      index,
      owner: player,
      zoneName,
    })),
  );
}

function moveSimulatedCard(
  owner: DragonPlayer,
  card: DragonCard,
  fromZone: DragonZoneName,
  toZone: DragonZoneName,
  state: DragonSimulationState | null = null,
): void {
  if (!owner || !card) return;
  const sourceZone =
    fromZone === "fieldSpell"
      ? owner.fieldSpell
        ? [owner.fieldSpell]
        : []
      : (owner as DragonZoneStorage)[fromZone] || [];
  const sourceIndex = sourceZone.indexOf(card);
  if (sourceIndex < 0) return;
  if (fromZone === "fieldSpell") {
    owner.fieldSpell = null;
  } else {
    sourceZone.splice(sourceIndex, 1);
  }
  putSimulatedCard(owner, card, toZone);
  if (state && fromZone === "hand" && toZone === "graveyard") {
    applyDragonHandToGraveyardTriggers(state, owner, card);
  }
}

function applySimulatedPassiveBuffs(
  card: DragonCard,
  owner: DragonPlayer,
): void {
  for (const effect of card.effects || []) {
    const passive = (effect as EffectDefinition & {
      passive?: PassiveRuleDefinition;
    })?.passive;
    if (passive?.type !== "graveyard_type_count_buff") continue;
    const count = (owner.graveyard || []).filter(
      (candidate) =>
        candidate &&
        candidate.cardKind === "monster" &&
        candidate.type === passive.monsterType,
    ).length;
    const amount = (passive.amountPerCard || 0) * count;
    if ((passive.stats || []).includes("atk")) {
      card.atk = (card.atk || 0) + amount;
    }
    if ((passive.stats || []).includes("def")) {
      card.def = (card.def || 0) + amount;
    }
  }
}

/**
 * Picks the worst card to discard (least valuable for the Dragon strategy).
 */
function pickWorstDiscard(
  hand: readonly DragonCard[],
  context: DragonDiscardContext = {},
): number {
  if (!hand || hand.length === 0) return 0;
  const state = context.state || null;
  const player = context.player || state?.bot || {};
  const entries = hand.map((candidate, index) => ({ candidate, index }));
  const ranked = rankDiscardEntriesForSimulation(
    entries,
    state || { bot: player, player: {} },
    context.source || null,
    context.effect || null,
  );
  return ranked[0]?.index ?? 0;
}
