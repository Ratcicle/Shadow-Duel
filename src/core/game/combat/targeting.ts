/**
 * Combat targeting - attack target selection interface.
 * Extracted from Game.js as part of B.5 modularization.
 */

import type { GameCard } from "../../contracts/cards.js";
import type { GamePlayer } from "../../contracts/player.js";
import type { SelectionCandidateKey } from "../../contracts/primitives.js";
import type {
  RawSelectionCandidate,
  RawSelectionContract,
  RawSelectionRequirement,
  SelectionCardReference,
  SelectionResult,
  SelectionSessionInput,
} from "../../contracts/selection.js";

type AttackCard = GameCard & {
  canAttackAllOpponentMonstersThisTurn?: boolean;
  passiveExtraAttackTargetRestriction?: string | null;
};

type AttackSelectionCard = AttackCard & SelectionCardReference;

function asAttackSelectionCard(card: AttackCard): AttackSelectionCard {
  return card as AttackSelectionCard;
}

interface AttackCandidate extends RawSelectionCandidate {
  idx: number;
  name: string;
  owner: "player" | "opponent";
  controller: string;
  zone: "field" | "hand";
  zoneIndex: number;
  cardRef: AttackSelectionCard | null;
  key?: SelectionCandidateKey;
  isDirectAttack?: boolean;
}

interface AttackRequirement extends RawSelectionRequirement {
  id: "attack_target";
  candidates: AttackCandidate[];
}

interface AttackSelectionHost {
  player: GamePlayer;
  bot: GamePlayer;
  getZone(player: GamePlayer, zone: "field"): GameCard[] | null;
  buildSelectionCandidateKey(
    candidate: RawSelectionCandidate,
    fallbackIndex?: number,
  ): SelectionCandidateKey;
  startTargetSelectionSession(session: SelectionSessionInput): void;
  resolveCombat(
    attacker: AttackCard,
    target: AttackCard | null,
    options: {
      allowDuringSelection: true;
      allowDuringResolving: true;
    },
  ): Promise<unknown>;
}

/**
 * Start an attack target selection session for the player.
 * Creates a selection contract with valid attack targets.
 * @param attacker - The monster that is attacking
 * @param {Array} candidates - Array of valid target monsters
 */
export function startAttackTargetSelection(
  this: AttackSelectionHost,
  attacker: AttackCard | null | undefined,
  candidates: AttackCard[] | null | undefined,
): void {
  if (!attacker || !Array.isArray(candidates)) return;

  const isMultiAttackMode = attacker.canAttackAllOpponentMonstersThisTurn;
  const attackerOwner = attacker.owner === "player" ? this.player : this.bot;
  const usingMonsterOnlyExtraAttack =
    (attacker.attacksUsedThisTurn || 0) > 0 &&
    (attacker.extraAttackTargetRestriction ||
      attacker.passiveExtraAttackTargetRestriction) === "monster";
  const canDirect =
    !attacker.cannotAttackDirectly &&
    !attackerOwner?.forbidDirectAttacksThisTurn &&
    !isMultiAttackMode && // Multi-attack can only target monsters, not direct
    !usingMonsterOnlyExtraAttack &&
    (attacker.canAttackDirectlyThisTurn === true || candidates.length === 0);

  if (candidates.length === 0 && !canDirect) return;
  const decorated: AttackCandidate[] = candidates.map((card, idx) => {
    const ownerLabel = card.owner === attacker.owner ? "player" : "opponent";
    const ownerPlayer = card.owner === "player" ? this.player : this.bot;
    const zoneArr = this.getZone(ownerPlayer, "field") || [];
    const zoneIndex = zoneArr.indexOf(card);
    const candidate: AttackCandidate = {
      idx,
      name: card.name,
      owner: ownerLabel,
      controller: card.owner,
      zone: "field",
      zoneIndex,
      position: card.position,
      atk: card.atk,
      def: card.def,
      cardKind: card.cardKind,
      cardRef: asAttackSelectionCard(card),
    };
    candidate.key = this.buildSelectionCandidateKey(candidate, idx);
    return candidate;
  });

  // Adiciona alvo de ataque direto (clicar na mao do oponente) quando permitido
  if (canDirect) {
    const opponentPlayer = attacker.owner === "player" ? this.bot : this.player;
    decorated.push({
      idx: decorated.length,
      name: "Direct Attack",
      owner: "opponent",
      controller: opponentPlayer.id,
      zone: "hand",
      zoneIndex: -1,
      position: "attack",
      atk: 0,
      def: 0,
      cardKind: "direct",
      cardRef: null,
      isDirectAttack: true,
      key: this.buildSelectionCandidateKey(
        {
          controller: opponentPlayer.id,
          zone: "hand",
          zoneIndex: -1,
          name: "Direct Attack",
        },
        decorated.length
      ),
    });
  }

  const requirement: AttackRequirement = {
    id: "attack_target",
    min: 1,
    max: 1,
    zones: [...new Set(decorated.map((cand) => cand.zone).filter(Boolean))],
    owner: "opponent",
    filters: {},
    allowSelf: true,
    distinct: true,
    candidates: decorated,
  };
  const selectionContract: RawSelectionContract = {
    kind: "choice",
    message: "Select a monster to attack.",
    requirements: [requirement],
    ui: { useFieldTargeting: true },
    metadata: { context: "attack" },
  };

  this.startTargetSelectionSession({
    kind: "attack",
    attacker: asAttackSelectionCard(attacker),
    selectionContract,
    execute: (selections: SelectionResult) => {
      const chosenKeys = selections[requirement.id] || [];
      const chosenKey = chosenKeys[0];
      const chosenCandidate = requirement.candidates.find(
        (cand) => cand.key === chosenKey
      );
      if (chosenCandidate?.isDirectAttack) {
        this.resolveCombat(attacker, null, {
          allowDuringSelection: true,
          allowDuringResolving: true,
        }).catch((err) => console.error(err));
      } else if (chosenCandidate?.cardRef) {
        this.resolveCombat(attacker, chosenCandidate.cardRef, {
          allowDuringSelection: true,
          allowDuringResolving: true,
        }).catch((err) => console.error(err));
      }
      return { success: true, needsSelection: false };
    },
  });
}
