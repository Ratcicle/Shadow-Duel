/**
 * Selection handlers - click handling and high-level selection API.
 * Extracted from Game.js as part of B.3 modularization.
 */

import type { CardFilter } from "../../contracts/effects.js";
import type {
  ActiveSelectionSession,
  RawSelectionCandidate,
  RawSelectionContract,
  RawSelectionRequirement,
  SelectionCandidate,
  SelectionCardReference,
  SelectionPlayerReference,
  SelectionRequirement,
  SelectionResult,
  SelectionSessionInput,
  SelectionSessionResolver,
  SelectionZone,
} from "../../contracts/selection.js";
import type { ZoneInput } from "../../contracts/zones.js";

interface TargetSelectionHandlerHost {
  targetSelection: ActiveSelectionSession | null;
  player: SelectionPlayerReference;
  bot: SelectionPlayerReference;
  advanceTargetSelection(): void;
  highlightTargetCandidates(): void;
  updateFieldTargetingProgress(): void;
}

interface AskPlayerSelectionConfig {
  owner?: "player";
  zone?: ZoneInput;
  filter?:
    | CardFilter
    | ((card: SelectionCardReference) => boolean);
  min?: number;
  max?: number;
  useFieldTargeting?: boolean;
  message?: string | null;
}

interface SelectionHandlerHost {
  player: SelectionPlayerReference;
  bot: SelectionPlayerReference;
  getZone(
    player: SelectionPlayerReference,
    zone: ZoneInput,
  ): SelectionCardReference[] | null;
  buildSelectionCandidateKey(
    candidate: RawSelectionCandidate,
    fallbackIndex?: number,
  ): SelectionCandidate["key"];
  canUseFieldTargeting(
    requirements: RawSelectionRequirement[],
  ): boolean;
  startTargetSelectionSession(
    session: SelectionSessionInput,
  ): void | Promise<void>;
}

interface CustomSelectionRequirement extends RawSelectionRequirement {
  id: string;
  candidates: SelectionCandidate[];
}

/**
 * Handle a click on a target during field targeting selection.
 * The card element stays in the signature for compatibility with Renderer.
 */
export function handleTargetSelectionClick(
  this: TargetSelectionHandlerHost,
  ownerId: string,
  cardIndex: number,
  _cardEl: HTMLElement,
  location: SelectionZone | null = null,
): boolean {
  if (!this.targetSelection) return false;
  if (!this.targetSelection.usingFieldTargeting) return false;
  if (
    this.targetSelection.state &&
    this.targetSelection.state !== "selecting"
  ) {
    return false;
  }

  console.log("[Game] Target selection click:", {
    ownerId,
    cardIndex,
    currentRequirement: this.targetSelection.currentRequirement,
    requirementsLength: this.targetSelection.requirements?.length,
  });

  const requirement =
    this.targetSelection.requirements[this.targetSelection.currentRequirement];
  if (!requirement) {
    console.log("[Game] No option found");
    return false;
  }

  const ownerPlayer = ownerId === "player" ? this.player : this.bot;
  let card: SelectionCardReference | null | undefined = null;
  const zoneHint = location || requirement.zones?.[0] || "field";

  if (zoneHint === "fieldSpell") {
    card = ownerPlayer.fieldSpell;
  } else if (zoneHint === "spellTrap") {
    card = ownerPlayer.spellTrap[cardIndex];
  } else if (zoneHint === "hand") {
    card = ownerPlayer.hand[cardIndex];
  } else {
    card = ownerPlayer.field[cardIndex];
  }

  if (!card) {
    console.log("[Game] Card not found at index:", cardIndex);
    return true;
  }

  console.log("[Game] Looking for candidate:", {
    cardName: card.name,
    cardIndex: cardIndex,
    candidatesCount: requirement.candidates.length,
    candidateNames: requirement.candidates.map(
    (candidate) => `${candidate.name} [idx:${candidate.zoneIndex}]`,
    ),
  });

  // Find candidate by matching card reference (most reliable method)
  // NOTE: We use cardRef identity match instead of zoneIndex because
  // zoneIndex can become stale if the board is re-rendered between
  // when decoratedCandidates were created and when the click occurs
  const candidate = requirement.candidates.find(
    (candidate) => candidate.cardRef === card,
  );

  if (!candidate) {
    console.log("[Game] Candidate not found. Checking references:");
    requirement.candidates.forEach((candidate, index) => {
      console.log(`  Candidate ${index}:`, {
        name: candidate.name,
        zoneIndex: candidate.zoneIndex,
        cardIndex: cardIndex,
        refMatch: candidate.cardRef === card,
      });
    });
    return true;
  }

  const selections = this.targetSelection.selections[requirement.id] || [];
  const min = Number(requirement.min ?? 0);
  const max = Number(requirement.max ?? 0);
  const existing = selections.indexOf(candidate.key);
  if (existing > -1) {
    const canResolveWithCurrentSelection =
      selections.length >= min &&
      (max <= 0 || selections.length <= max);
    if (
      this.targetSelection.confirmOnRepeatedTarget !== false &&
      canResolveWithCurrentSelection
    ) {
      console.log("[Game] Repeated target click, confirming selection");
      this.advanceTargetSelection();
      return true;
    }
    selections.splice(existing, 1);
    console.log("[Game] Deselected card");
  } else {
    if (max > 0 && selections.length >= max) {
      if (max === 1) {
        selections.splice(0, selections.length, candidate.key);
        console.log("[Game] Replaced selected target");
        this.targetSelection.selections[requirement.id] = selections;
        this.highlightTargetCandidates();
        this.updateFieldTargetingProgress();
        return true;
      }
      console.log("[Game] Max selections reached");
      return true;
    }
    selections.push(candidate.key);
    console.log(
      "[Game] Selected card, total:",
      selections.length,
      "/",
      max || requirement.max
    );
  }
  this.targetSelection.selections[requirement.id] = selections;

  const shouldAutoAdvance = this.targetSelection.autoAdvanceOnMax !== false;

  if (shouldAutoAdvance && max > 0 && selections.length >= max) {
    console.log("[Game] Max reached, advancing selection");
    this.advanceTargetSelection();
  }
  this.highlightTargetCandidates();
  this.updateFieldTargetingProgress();

  return true;
}

/**
 * High-level API to ask the player to select cards from a zone.
 * @param {Object} config - Selection configuration
 * @returns {Promise<Array>} Promise resolving to selected cards
 */
export function askPlayerToSelectCards(
  this: SelectionHandlerHost,
  config: AskPlayerSelectionConfig = {},
): Promise<SelectionCardReference[]> {
  const owner = config.owner === "player" ? this.player : null;
  if (!owner) return Promise.resolve([]);

  const zoneName = config.zone || "field";
  let candidates = this.getZone(owner, zoneName) || [];

  const filter = config.filter;
  if (filter) {
    if (typeof filter === "function") {
      candidates = candidates.filter(filter);
    } else if (typeof filter === "object") {
      candidates = candidates.filter((card) => {
        return Object.entries(filter).every(([key, value]) => {
          if (!card) return false;
          const cardValue = Reflect.get(card, key);
          if (Array.isArray(value)) {
            return value.includes(cardValue);
          }
          return cardValue === value;
        });
      });
    }
  }

  const min = Math.max(1, config.min ?? 1);
  const max = Math.min(config.max ?? min, candidates.length);

  if (candidates.length < min) {
    return Promise.resolve([]);
  }

  const decorated = candidates.map((card, idx): RawSelectionCandidate => {
    const ownerLabel = card.owner === "player" ? "player" : "opponent";
    const ownerPlayer = card.owner === "player" ? this.player : this.bot;
    const zoneArr = this.getZone(ownerPlayer, zoneName) || [];
    const zoneIndex = zoneArr.indexOf(card);
    return {
      idx,
      name: card.name,
      owner: ownerLabel,
      controller: card.owner,
      zone: zoneName,
      zoneIndex,
      position: card.position,
      atk: card.atk,
      def: card.def,
      cardKind: card.cardKind,
      cardRef: card,
    };
  });

  return new Promise<SelectionCardReference[]>((resolve) => {
    const candidatesWithKeys = decorated.map((cand, idx): SelectionCandidate => {
      if (!cand.key) {
        cand.key = this.buildSelectionCandidateKey(cand, idx);
      }
      return cand as SelectionCandidate;
    });
    const requirement: CustomSelectionRequirement = {
      id: "custom_select",
      min,
      max,
      zones: [zoneName],
      owner: "player",
      filters: {},
      allowSelf: true,
      distinct: true,
      candidates: candidatesWithKeys,
    };
    const canUseFieldTargeting =
      typeof this.canUseFieldTargeting === "function"
        ? this.canUseFieldTargeting([requirement])
        : ["field", "spellTrap", "fieldSpell"].includes(zoneName);
    const useFieldTargeting =
      typeof config.useFieldTargeting === "boolean"
        ? config.useFieldTargeting && canUseFieldTargeting
        : canUseFieldTargeting;

    const selectionContract: RawSelectionContract = {
      kind: "choice",
      message:
        config.message || "Select card(s) by clicking the highlighted targets.",
      requirements: [requirement],
      ui: { useFieldTargeting },
      metadata: { context: "custom" },
    };

    this.startTargetSelectionSession({
      kind: "custom",
      selectionContract,
      resolve: resolve as SelectionSessionResolver,
      execute: (selections: SelectionResult) => {
        const chosenKeys = selections[requirement.id] || [];
        const chosen = chosenKeys
          .map((key) => requirement.candidates.find((cand) => cand.key === key))
          .map((cand) => cand?.cardRef)
          .filter(
            (card): card is SelectionCardReference => card != null,
          );
        resolve(chosen);
        return { success: true, needsSelection: false };
      },
    });
  });
}
