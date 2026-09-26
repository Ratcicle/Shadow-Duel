import type Game from "../../Game.js";
import type { BattlePosition, GameCard } from "../../contracts/cards.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { SummonExecutionResult } from "../../contracts/gameRuntime.js";
import type { RawSelectionContract } from "../../contracts/selection.js";
import { SUMMON_ORIGINS } from "../../contracts/summon.js";
import { checkSpecialSummonEligibility } from "./eligibility.js";

type HandProcedureHost = Pick<Game,
  "player" | "canStartAction" | "canPlaceCardOnField" | "effectEngine" |
  "startTargetSelectionSession" | "autoSelector" | "createPreparedSummon" |
  "executeSummonTransaction" | "moveCard" | "updateBoard"
>;

export interface HandSummonProcedureOptions {
  materials?: GameCard[];
  position?: BattlePosition;
}

export interface HandSummonProcedureCheck {
  ok: boolean;
  reason?: string;
  candidates: GameCard[];
  /** Legal cost witness for AI planning; human selection remains manual. */
  suggestedMaterials: GameCard[];
}

function findLegalCostSelection(
  game: HandProcedureHost,
  card: GameCard,
  player: GamePlayer,
  candidates: GameCard[],
  count: number,
): GameCard[] | null {
  const fieldCandidates = candidates.filter((candidate) => player.field.includes(candidate));
  const graveCandidates = candidates.filter((candidate) => player.graveyard.includes(candidate));
  // Only field subsets change placement legality; at most five field cards exist.
  const search = (index: number, selected: GameCard[]): GameCard[] | null => {
    if (selected.length > count) return null;
    if (index === fieldCandidates.length) {
      if (selected.length + graveCandidates.length < count || player.field.length - selected.length >= 5) return null;
      if (!game.canPlaceCardOnField(card, player, {
        isFacedown: false, summonMethod: "special", silent: true, excludeCards: selected,
      }).ok) return null;
      return [...selected, ...graveCandidates.slice(0, count - selected.length)];
    }
    const without = search(index + 1, selected);
    if (without) return without;
    const candidate = fieldCandidates[index];
    return candidate ? search(index + 1, [...selected, candidate]) : null;
  };
  return search(0, []);
}

export function canSummonFromHandByProcedure(
  this: HandProcedureHost,
  card: GameCard,
  player: GamePlayer,
): HandSummonProcedureCheck {
  return checkHandProcedure.call(this, card, player, false);
}

function checkHandProcedure(
  this: HandProcedureHost,
  card: GameCard,
  player: GamePlayer,
  completingSelection = false,
): HandSummonProcedureCheck {
  const unavailable = (reason: string): HandSummonProcedureCheck => ({ ok: false, reason, candidates: [], suggestedMaterials: [] });
  const procedure = card.handSummonProcedure;
  if (!procedure || !player.hand.includes(card)) return unavailable("missing_hand_procedure");
  const guard = this.canStartAction({ actor: player, kind: "summon", phaseReq: ["main1", "main2"], silent: true, allowDuringResolving: completingSelection });
  if (!guard.ok) return unavailable(guard.reason || "summon_unavailable");
  const eligibility = checkSpecialSummonEligibility(card, { summonProcedure: procedure.id, fromZone: "hand" });
  if (!eligibility.ok) return unavailable(eligibility.reason || "special_summon_restriction");
  if (!Number.isInteger(procedure.cost.count) || procedure.cost.count < 1) return unavailable("invalid_cost_count");
  const candidates = [...new Set(procedure.cost.zones.flatMap((zone) => player[zone]))]
    .filter((candidate) => this.effectEngine.cardMatchesFilters(candidate, procedure.cost.filters));
  if (candidates.length < procedure.cost.count) return unavailable("insufficient_materials");
  if (player.field.length >= 5 && !candidates.some((candidate) => player.field.includes(candidate))) return unavailable("field_full");
  const suggestedMaterials = findLegalCostSelection(this, card, player, candidates, procedure.cost.count);
  if (!suggestedMaterials) return unavailable("field_unavailable");
  return { ok: true, candidates, suggestedMaterials };
}

export async function performHandSummonProcedure(
  this: HandProcedureHost,
  card: GameCard,
  player: GamePlayer = this.player,
  options: HandSummonProcedureOptions = {},
): Promise<SummonExecutionResult> {
  return executeHandProcedure.call(this, card, player, options, false);
}

async function executeHandProcedure(
  this: HandProcedureHost,
  card: GameCard,
  player: GamePlayer,
  options: HandSummonProcedureOptions,
  completingSelection: boolean,
): Promise<SummonExecutionResult> {
  const check = checkHandProcedure.call(this, card, player, completingSelection);
  const procedure = card.handSummonProcedure;
  if (!check.ok || !procedure) return { success: false, reason: check.reason || "missing_hand_procedure" };
  let materials = options.materials;
  if (!materials) {
    const candidates = check.candidates.map((material, index) => ({
      key: `${material.instanceId}_${index}`,
      cardRef: material, name: material.name, image: material.image,
      atk: material.atk, def: material.def,
      zone: player.field.includes(material) ? "field" as const : "graveyard" as const,
      owner: player.id === "player" ? "player" as const : "opponent" as const,
    }));
    const contract: RawSelectionContract = {
      kind: "cost",
      requirements: [{ id: "hand_summon_cost", candidates, min: procedure.cost.count, max: procedure.cost.count, intent: "cost", distinct: true }],
      ui: { allowCancel: true, message: card.description || card.name },
    };
    const selectedCards = (keys: readonly string[]) => keys.flatMap((key) => {
      const candidate = candidates.find((entry) => entry.key === key);
      return candidate ? [candidate.cardRef] : [];
    });
    if (player.controllerType === "ai") {
      const result = this.autoSelector.select(contract, { owner: player, selectionKind: "cost", selectionContract: contract });
      materials = selectedCards(result?.ok ? result.selections.hand_summon_cost || [] : []);
      if (materials.length !== procedure.cost.count ||
          player.field.filter((fieldCard) => !materials?.includes(fieldCard)).length >= 5 ||
          !this.canPlaceCardOnField(card, player, { isFacedown: false, summonMethod: "special", silent: true, excludeCards: materials }).ok) {
        materials = check.suggestedMaterials;
      }
    } else {
      const sourceVersion = card.locationVersion;
      this.startTargetSelectionSession({
        kind: "cost", card, owner: player, selectionContract: contract,
        execute: async (selections) => {
          if (card.locationVersion !== sourceVersion) return { success: false, needsSelection: false };
          const result = await executeHandProcedure.call(this, card, player, {
            ...options, materials: selectedCards(selections.hand_summon_cost || []),
          }, true);
          return { success: result.success === true, needsSelection: false };
        },
      });
      return { success: false, needsSelection: true, selectionContract: contract };
    }
  }
  if (materials.length !== procedure.cost.count || new Set(materials).size !== materials.length ||
      materials.some((material) => !check.candidates.includes(material))) {
    return { success: false, reason: "invalid_materials" };
  }
  const placement = this.canPlaceCardOnField(card, player, {
    isFacedown: false, summonMethod: "special", excludeCards: materials,
  });
  if (!placement.ok) return { success: false, reason: placement.reason || "field_unavailable" };
  if (player.field.filter((fieldCard) => !materials.includes(fieldCard)).length >= 5) return { success: false, reason: "field_full" };
  const sourceVersion = card.locationVersion;
  const position = await this.effectEngine.chooseSpecialSummonPosition(card, player, options);
  if (!player.hand.includes(card) || card.locationVersion !== sourceVersion) return { success: false, reason: "source_moved" };
  const recheck = checkHandProcedure.call(this, card, player, completingSelection);
  if (!recheck.ok || materials.some((material) => !recheck.candidates.includes(material))) return { success: false, reason: "summon_unavailable" };
  const finalPlacement = this.canPlaceCardOnField(card, player, {
    isFacedown: false, summonMethod: "special", excludeCards: materials,
  });
  if (!finalPlacement.ok || player.field.filter((fieldCard) => !materials.includes(fieldCard)).length >= 5) return { success: false, reason: "field_unavailable" };
  const prepared = this.createPreparedSummon({
    card, controller: player, sourceZone: "hand",
    summonOrigin: SUMMON_ORIGINS.PROCEDURE, summonMode: "summon",
    summonMethod: "special", summonProcedure: procedure.id, position,
    costPayments: materials.map((material) => ({
      card: material, owner: player,
      fromZone: player.field.includes(material) ? "field" : "graveyard",
      toZone: procedure.cost.destination, kind: "hand_summon_cost",
      options: { movedByEffect: false },
    })),
    perform: async (transaction) => {
      if (!player.hand.includes(card) || card.locationVersion !== sourceVersion) return { success: false, reason: "source_moved" };
      return this.moveCard(card, player, "field", {
        fromZone: "hand", position, isFacedown: false, resetAttackFlags: true,
        summonMethodOverride: "special", summonProcedure: procedure.id,
        summonOrigin: SUMMON_ORIGINS.PROCEDURE, summonTransaction: transaction,
        awaitCardMovedEvent: true,
      });
    },
  });
  const result = await this.executeSummonTransaction(prepared);
  this.updateBoard();
  return result;
}
